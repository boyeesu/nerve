import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { WebSocketServer } from "ws";
import { hermesAdapter } from "../lib/adapters/hermes";
import { openClawAdapter, openClawHistory } from "../lib/adapters/openclaw";
import { createOpenClawDeviceIdentity } from "../lib/crypto";

const originalPrivateNetworks = process.env.NERVE_ALLOW_PRIVATE_NETWORKS;
test.afterEach(() => {
  if (originalPrivateNetworks === undefined) delete process.env.NERVE_ALLOW_PRIVATE_NETWORKS;
  else process.env.NERVE_ALLOW_PRIVATE_NETWORKS = originalPrivateNetworks;
});

test("Hermes adapter probes, discovers, and sends commands against the contract", async (t) => {
  process.env.NERVE_ALLOW_PRIVATE_NETWORKS = "true";
  const requests: Array<{ path: string; method: string; authorization?: string }> = [];
  const server = createServer((request, response) => {
    requests.push({
      path: request.url ?? "",
      method: request.method ?? "",
      authorization: request.headers.authorization,
    });
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/capabilities") response.end(JSON.stringify({ model: "hermes-test" }));
    else if (request.url === "/health/detailed") response.end(JSON.stringify({ status: "ok" }));
    else if (request.url === "/v1/runs" && request.method === "GET") response.end("[]");
    else if (request.url === "/v1/runs" && request.method === "POST") response.end(JSON.stringify({ run_id: "run-1" }));
    else if (request.url === "/v1/skills") response.end(JSON.stringify({ skills: [{ name: "research" }] }));
    else {
      response.statusCode = 404;
      response.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert(address && typeof address === "object");
  const connection = {
    runtime: "hermes" as const,
    endpoint: `http://127.0.0.1:${address.port}`,
    credentials: { token: "hermes-token" },
  };

  const probe = await hermesAdapter.probe(connection);
  assert.equal(probe.status, "connected");
  assert.equal((await hermesAdapter.listAgents(connection))[0].model, "hermes-test");
  assert.equal((await hermesAdapter.listSkills(connection, "hermes-default"))[0].key, "research");
  const result = await hermesAdapter.act(connection, {
    type: "message",
    agentId: "hermes-default",
    input: "hello",
    idempotencyKey: "message-1",
  });
  assert.equal(result.run_id, "run-1");
  assert(requests.every((request) => request.authorization === "Bearer hermes-token"));
});

test("OpenClaw protocol-v4 adapter signs in and lists agents", async (t) => {
  process.env.NERVE_ALLOW_PRIVATE_NETWORKS = "true";
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  server.on("connection", (socket) => {
    socket.send(JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1", ts: Date.now() },
    }));
    socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.method === "connect") {
        assert.equal(frame.params.maxProtocol, 4);
        assert.equal(frame.params.client.displayName, "Nerve");
        assert(frame.params.device.signature);
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            protocol: 4,
            auth: { scopes: ["operator.read"], deviceToken: "issued-device-token" },
          },
        }));
      } else if (frame.method === "agents.list") {
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { agents: [{ id: "main", name: "Rachael" }] },
        }));
      } else if (frame.method === "chat.history") {
        assert.equal(frame.params.sessionKey, "agent:main:main");
        assert.equal(frame.params.agentId, "main");
        assert.equal(frame.params.limit, 50);
        socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true,
          payload: { messages: [{ role: "assistant", content: [{ type: "text", text: "Verified history" }] }] } }));
      }
    });
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const identity = createOpenClawDeviceIdentity();
  const probe = await openClawAdapter.probe({
    runtime: "openclaw",
    endpoint: `ws://127.0.0.1:${address.port}`,
    credentials: {
      token: "gateway-token",
      scopes: ["operator.read"],
      ...identity,
    },
  });
  assert.equal(probe.status, "connected");
  assert.equal(probe.capabilities.agentCount, 1);
  assert.equal(probe.issuedDeviceToken, "issued-device-token");
  const history = await openClawHistory({
    runtime: "openclaw", endpoint: `ws://127.0.0.1:${address.port}`,
    credentials: { token: "gateway-token", scopes: ["operator.read"], ...identity },
  }, "main");
  assert.equal((history.messages as Array<{ role: string }>)[0].role, "assistant");
});

test("OpenClaw pairing errors retain the request identifier", async (t) => {
  process.env.NERVE_ALLOW_PRIVATE_NETWORKS = "true";
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  server.on("connection", (socket) => {
    socket.send(JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-2", ts: Date.now() },
    }));
    socket.once("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      socket.send(JSON.stringify({
        type: "res",
        id: frame.id,
        ok: false,
        error: {
          message: "pairing required",
          details: { code: "PAIRING_REQUIRED", requestId: "request-123" },
        },
      }));
    });
  });
  const address = server.address();
  assert(address && typeof address === "object");
  await assert.rejects(
    openClawAdapter.probe({
      runtime: "openclaw",
      endpoint: `ws://127.0.0.1:${address.port}`,
      credentials: { token: "gateway-token", ...createOpenClawDeviceIdentity() },
    }),
    /Request ID: request-123/,
  );
});

for (const invalidFrame of ["null", "[]", '"unexpected"', '{"type":"res","ok":true,"payload":null}']) {
  test(`OpenClaw rejects malformed frame ${invalidFrame} without crashing`, async (t) => {
    process.env.NERVE_ALLOW_PRIVATE_NETWORKS = "true";
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    server.on("connection", (socket) => socket.send(invalidFrame));
    const address = server.address();
    assert(address && typeof address === "object");
    await assert.rejects(openClawAdapter.probe({
      runtime: "openclaw",
      endpoint: `ws://127.0.0.1:${address.port}`,
      credentials: { token: "test-token", ...createOpenClawDeviceIdentity() },
    }), /invalid protocol/);
  });
}

test("existing connections are revalidated before connecting to IP literals", async () => {
  process.env.NERVE_ALLOW_PRIVATE_NETWORKS = "false";
  await assert.rejects(hermesAdapter.probe({
    runtime: "hermes", endpoint: "https://127.0.0.1:1", credentials: { token: "test" },
  }), /Private runtime addresses/);
  await assert.rejects(openClawAdapter.probe({
    runtime: "openclaw", endpoint: "wss://[::ffff:169.254.169.254]",
    credentials: { token: "test", ...createOpenClawDeviceIdentity() },
  }), /metadata/);
});

test("duplicate OpenClaw challenges and acknowledgements dispatch the command only once", async (t) => {
  process.env.NERVE_ALLOW_PRIVATE_NETWORKS = "true";
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  let connections = 0;
  let commands = 0;
  server.on("connection", (socket) => {
    const challenge = JSON.stringify({
      type: "event", event: "connect.challenge", payload: { nonce: "repeated", ts: Date.now() },
    });
    socket.send(challenge);
    socket.send(challenge);
    socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.method === "connect") {
        connections += 1;
        const acknowledgement = JSON.stringify({ type: "res", id: frame.id, ok: true, payload: {} });
        socket.send(acknowledgement);
        socket.send(acknowledgement);
      } else {
        commands += 1;
        assert.equal(frame.method, "chat.send");
        assert.equal(frame.params.idempotencyKey, "duplicate-handshake-test");
        socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { runId: "once" } }));
      }
    });
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const result = await openClawAdapter.act({
    runtime: "openclaw",
    endpoint: `ws://127.0.0.1:${address.port}`,
    credentials: { token: "test", ...createOpenClawDeviceIdentity() },
  }, { type: "message", agentId: "main", input: "hello", idempotencyKey: "duplicate-handshake-test" });
  assert.equal(result.runId, "once");
  // Await server-side closure so every received frame has been counted.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  assert.equal(connections, 1);
  assert.equal(commands, 1);
});

test("Hermes never presents historical or unavailable runs as active work", async (t) => {
  process.env.NERVE_ALLOW_PRIVATE_NETWORKS = "true";
  let runs = '[{"status":"completed"}]';
  let capabilities = '{"model":"status-test"}';
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(request.url === "/v1/capabilities" ? capabilities : runs);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert(address && typeof address === "object");
  const connection = {
    runtime: "hermes" as const, endpoint: `http://127.0.0.1:${address.port}`, credentials: { token: "test" },
  };
  assert.equal((await hermesAdapter.listAgents(connection))[0].status, "unknown");
  runs = "[]";
  assert.equal((await hermesAdapter.listAgents(connection))[0].status, "idle");
  runs = '{"runs":[{"state":"running"}]}';
  assert.equal((await hermesAdapter.listAgents(connection))[0].status, "working");
  runs = "null";
  assert.equal((await hermesAdapter.listAgents(connection))[0].status, "unknown");
  capabilities = "null";
  await assert.rejects(hermesAdapter.listAgents(connection), /invalid response object/);
});
