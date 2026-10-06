import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import test from "node:test";

const base = process.env.NERVE_TEST_BASE_URL;
const token = process.env.NERVE_TEST_ADMIN_TOKEN;

test("real HTTP routes persist, replay, authorize, and reconcile actions", {
  skip: !base || !token ? "Set NERVE_TEST_BASE_URL and NERVE_TEST_ADMIN_TOKEN for a disposable local server/database." : false,
}, async (t) => {
  assert(base && token);
  assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname),
    "Integration tests are restricted to disposable local servers.");
  let delivered = 0;
  let failNext = false;
  const runtimeRequests: string[] = [];
  const runtime = createServer((request, response) => {
    runtimeRequests.push(`${request.method} ${request.url}`);
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/capabilities") response.end('{"model":"integration-model"}');
    else if (request.url === "/health/detailed") response.end('{"status":"ok"}');
    else if (request.url === "/v1/runs" && request.method === "GET") response.end("[]");
    else if (request.url === "/v1/runs" && request.method === "POST") {
      delivered += 1;
      if (failNext) {
        failNext = false;
        response.statusCode = 504;
        response.end('{"detail":"Runtime timed out after accepting work"}');
      } else response.end(JSON.stringify({ run_id: `integration-run-${delivered}` }));
    } else if (request.url?.endsWith("/events")) {
      response.setHeader("content-type", "text/event-stream");
      response.end('id: 1\ndata: {"event":"message.delta","delta":"Real fixture reply","seq":1}\n\nid: 2\ndata: {"event":"run.completed","seq":2}\n\n');
    } else if (request.url?.startsWith("/v1/runs/")) {
      response.end(JSON.stringify({ status: "completed", output: "Real fixture reply", session_id: "session-1" }));
    } else if (request.url === "/v1/skills") response.end('{"skills":[{"name":"research"}]}');
    else { response.statusCode = 404; response.end("{}"); }
  });
  await new Promise<void>((resolve) => runtime.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => runtime.close(() => resolve())));
  const address = runtime.address();
  assert(address && typeof address === "object");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const call = (path: string, init?: RequestInit) => fetch(`${base}${path}`, {
    ...init, headers: { ...headers, ...init?.headers },
  });

  assert.equal((await fetch(`${base}/api/connections`)).status, 401);
  const created = await call("/api/connections", {
    method: "POST",
    body: JSON.stringify({
      name: "Disposable integration runtime", runtime: "hermes",
      endpoint: `http://127.0.0.1:${address.port}`, token: "fixture-runtime-token",
    }),
  });
  assert.equal(created.status, 201, await created.clone().text());
  const { connection } = await created.json();
  const path = `/api/connections/${connection.id}`;
  t.after(async () => { await call(path, { method: "DELETE" }); });
  assert(!("credentials" in connection));
  assert(!("encryptedCredentials" in connection));
  const discovered = await (await call(`${path}/agents`)).json();
  assert.equal(discovered.agents[0].model, "integration-model");

  const key = randomUUID();
  const action = { type: "message", agentId: "hermes-default", input: "Hello test runtime" };
  const send = (idempotencyKey: string, body: unknown, retry = false) => call(`${path}/actions`, {
    method: "POST", headers: { "idempotency-key": idempotencyKey, "x-nerve-retry": String(retry) },
    body: JSON.stringify(body),
  });
  const first = await send(key, action);
  assert.equal(first.status, 200, await first.clone().text());
  const receipt = await first.json();
  const replay = await send(key, { input: action.input, agentId: action.agentId, type: action.type });
  assert.equal(replay.status, 200, await replay.clone().text());
  const replayReceipt = await replay.json();
  assert.equal(replayReceipt.replayed, true);
  assert.deepEqual(replayReceipt.result, receipt.result);
  assert.equal(delivered, 1);
  assert.equal((await send(key, { ...action, input: "Different command" })).status, 409);
  assert.equal((await send(randomUUID(), { type: "stop", agentId: "hermes-default" })).status, 400);
  assert.equal((await call("/api/connections/not-a-uuid/agents")).status, 404);

  failNext = true;
  const uncertainKey = randomUUID();
  const uncertain = await send(uncertainKey, action);
  assert.equal(uncertain.status, 202);
  assert.equal((await uncertain.json()).retryable, false);
  assert.equal((await send(uncertainKey, action, true)).status, 409);
  assert.equal(delivered, 2, "An ambiguous Hermes run must not be delivered twice");

  const history = await (await call(`${path}/actions?agentId=hermes-default`)).json();
  const saved = history.actions.find((row: { idempotencyKey: string }) => row.idempotencyKey === key);
  const unknown = history.actions.find((row: { idempotencyKey: string }) => row.idempotencyKey === uncertainKey);
  const observed = await call(`${path}/actions/${saved.id}/observe`);
  assert.equal(observed.status, 200);
  assert.equal((await observed.json()).snapshot.output, "Real fixture reply");
  const events = await call(`${path}/actions/${saved.id}/events`);
  assert.equal(events.status, 200);
  assert.match(await events.text(), /Real fixture reply/);
  assert.equal((await call(`${path}/actions/${randomUUID()}/observe`)).status, 404);

  const reconcile = await call(`${path}/actions/${unknown.id}`, {
    method: "PATCH", body: JSON.stringify({ observedOutcome: "delivered", note: "Checked fixture runtime log: run accepted." }),
  });
  assert.equal(reconcile.status, 200);
  assert.equal((await send(uncertainKey, action, true)).status, 409, "A reconciled action must not be resent.");
  assert.equal(delivered, 2);

  const missionResponse = await call("/api/missions", { method: "POST", body: JSON.stringify({
    name: "Integration fleet mission", description: "Hello fleet", targets: [
      { connectionId: connection.id, agentId: "hermes-default" }, { connectionId: connection.id, agentId: "second-fixture" },
    ],
  }) });
  assert.equal(missionResponse.status, 201, await missionResponse.clone().text());
  const { mission } = await missionResponse.json();
  t.after(async () => { await call(`/api/missions/${mission.id}`, { method: "DELETE" }); });
  const launchKey = randomUUID();
  const launch = () => call(`/api/missions/${mission.id}`, {
    method: "POST", headers: { "idempotency-key": launchKey }, body: JSON.stringify({ confirmTargetCount: 2 }),
  });
  assert.equal((await call(`/api/missions/${mission.id}`, {
    method: "POST", headers: { "idempotency-key": launchKey }, body: JSON.stringify({ confirmTargetCount: 1 }),
  })).status, 400);
  const launches = await Promise.all([launch(), launch()]);
  for (const response of launches) assert.equal(response.status, 202, await response.clone().text());
  const [a, b] = await Promise.all(launches.map((response) => response.json()));
  assert.deepEqual(a.receipts.map((receipt: { id: string }) => receipt.id), b.receipts.map((receipt: { id: string }) => receipt.id));
  for (let i = 0; i < 40 && delivered < 4; i++) await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(delivered, 4, "Worker should deliver each fleet target exactly once in this fixture.");
  assert.equal((await launch()).status, 202);
  assert.equal(delivered, 4);

  const otherToken = process.env.NERVE_TEST_OTHER_TOKEN;
  if (otherToken) {
    const otherHeaders = { authorization: `Bearer ${otherToken}` };
    const otherConnections = await (await call("/api/connections", { headers: otherHeaders })).json();
    assert(!otherConnections.connections.some((row: { id: string }) => row.id === connection.id));
    const before = runtimeRequests.length;
    for (const suffix of ["/agents", "/skills?agentId=hermes-default", "/actions",
      `/actions/${saved.id}/observe`, `/actions/${saved.id}/events`]) {
      assert.equal((await call(`${path}${suffix}`, { headers: otherHeaders })).status, 404, suffix);
    }
    for (const suffix of ["/probe", "/skills", "/actions"]) {
      assert.equal((await call(`${path}${suffix}`, { method: "POST", headers: otherHeaders,
        body: JSON.stringify(suffix === "/skills" ? { agentId: "hermes-default", skillKey: "research" } : action) })).status, 404, suffix);
    }
    assert.equal((await call(path, { method: "DELETE", headers: otherHeaders })).status, 404);
    assert.equal((await call(`${path}/actions/${unknown.id}`, { method: "PATCH", headers: otherHeaders,
      body: JSON.stringify({ observedOutcome: "delivered", note: "Must not reach runtime." }) })).status, 404);
    assert.equal((await call(`/api/missions/${mission.id}`, { method: "DELETE", headers: otherHeaders })).status, 404);
    assert.equal((await call(`/api/missions/${mission.id}`, { method: "POST", headers: otherHeaders,
      body: JSON.stringify({ confirmTargetCount: 2 }) })).status, 404);
    assert.equal(runtimeRequests.length, before, "Foreign workspace requests must not contact the runtime.");
    assert.equal((await call("/api/missions", { method: "POST", headers: otherHeaders, body: JSON.stringify({
      name: "Forbidden", description: "test", targets: [{ connectionId: connection.id, agentId: "main" }],
    }) })).status, 400);
  }

  const login = await fetch(`${base}/api/auth/session`, {
    method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ token }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await fetch(`${base}/api/connections`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${base}/api/connections`, {
    method: "POST", headers: { cookie, origin: "https://attacker.example" }, body: "{}",
  })).status, 403);
  assert.equal((await fetch(`${base}/api/auth/session`, {
    method: "DELETE", headers: { cookie, origin: base },
  })).status, 200);
  assert.equal((await fetch(`${base}/api/connections`, { headers: { cookie } })).status, 401,
    "Signing out must invalidate copied cookies, not just clear the browser cookie.");

  const oversized = await call(`${path}/actions`, {
    method: "POST", body: JSON.stringify({ ...action, input: "x".repeat(140_000) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await call(`${path}/skills`, { method: "POST", body: "null" })).status, 400);

  if (process.env.NERVE_TEST_VIEWER_TOKEN) {
    assert.equal((await call(`${path}/actions`, {
      method: "POST", headers: { authorization: `Bearer ${process.env.NERVE_TEST_VIEWER_TOKEN}` },
      body: JSON.stringify(action),
    })).status, 403);
    assert.equal((await call("/api/missions", { method: "POST",
      headers: { authorization: `Bearer ${process.env.NERVE_TEST_VIEWER_TOKEN}` }, body: "{}" })).status, 403);
    assert.equal((await call(`${path}/actions/${unknown.id}`, { method: "PATCH",
      headers: { authorization: `Bearer ${process.env.NERVE_TEST_VIEWER_TOKEN}` }, body: "{}" })).status, 403);
  }
});
