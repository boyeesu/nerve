import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  authenticateAccessKey,
  hasPermission,
  issueSessionCookieValue,
  sessionContext,
  requireApiAuth,
  isSameOrigin,
  actorCanDispatch,
} from "../lib/auth";
import { canRetryAction, sameActionRequest } from "../lib/action-policy";
import { beginAction } from "../lib/store";
import { decryptJson, encryptJson } from "../lib/crypto";
import { assertSafeRuntimeEndpoint } from "../lib/network-policy";
import { loginClientKey } from "../lib/rate-limit";
import { missionTargets } from "../lib/missions";

const originalEnvironment = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnvironment };
});

test("AES-GCM credentials round trip and reject shortened authentication tags", () => {
  process.env.NERVE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const encrypted = encryptJson({ token: "runtime-secret", scopes: ["operator.read"] });
  assert.deepEqual(decryptJson(encrypted), {
    token: "runtime-secret",
    scopes: ["operator.read"],
  });

  const [version, iv, ciphertext, tag] = encrypted.split(".");
  const shortenedTag = Buffer.from(tag, "base64url").subarray(0, 12).toString("base64url");
  assert.throws(
    () => decryptJson(`${version}.${iv}.${ciphertext}.${shortenedTag}`),
    /authentication tag is invalid/i,
  );
});

test("access keys issue signed role sessions with least privilege", () => {
  process.env.NERVE_SESSION_SECRET = "session-secret-that-is-long-enough-for-production";
  process.env.NERVE_ADMIN_TOKEN = "legacy-admin-token-with-adequate-entropy";
  process.env.NERVE_ACCESS_KEYS = JSON.stringify([
    { actor: "observer", role: "viewer", token: "viewer-token-with-adequate-entropy" },
    { actor: "operator-one", role: "operator", token: "operator-token-with-adequate-entropy" },
  ]);

  const viewer = authenticateAccessKey("viewer-token-with-adequate-entropy");
  assert.deepEqual(viewer, { actor: "observer", role: "viewer" });
  assert.equal(hasPermission(viewer!, "read"), true);
  assert.equal(hasPermission(viewer!, "actions.message"), false);

  const operator = authenticateAccessKey("operator-token-with-adequate-entropy");
  assert.equal(hasPermission(operator!, "actions.stop"), true);
  assert.equal(hasPermission(operator!, "skills.write"), false);

  const issuedAt = Date.now();
  const cookie = issueSessionCookieValue(operator!, issuedAt);
  assert.deepEqual(sessionContext(cookie, issuedAt + 1_000), operator);
  assert.equal(sessionContext(`${cookie}tampered`, issuedAt + 1_000), null);
  assert.equal(sessionContext(cookie, issuedAt + 13 * 60 * 60 * 1_000), null);
});

test("runtime endpoint policy blocks credentials, metadata, private and plaintext targets", async () => {
  process.env.NERVE_ALLOW_PRIVATE_NETWORKS = "false";
  await assert.rejects(
    assertSafeRuntimeEndpoint("http://127.0.0.1:8080", "hermes"),
    /plaintext runtime connections are disabled/i,
  );
  await assert.rejects(
    assertSafeRuntimeEndpoint("https://169.254.169.254/latest/meta-data", "hermes"),
    /link-local and cloud metadata/i,
  );
  await assert.rejects(
    assertSafeRuntimeEndpoint("https://user:pass@example.com", "hermes"),
    /cannot contain credentials/i,
  );

  process.env.NERVE_ALLOW_PRIVATE_NETWORKS = "true";
  assert.equal(
    await assertSafeRuntimeEndpoint("http://127.0.0.1:8080/v1", "hermes"),
    "http://127.0.0.1:8080",
  );
  await assert.rejects(
    assertSafeRuntimeEndpoint("http://169.254.169.254", "hermes"),
    /link-local and cloud metadata/i,
  );
});

test("action idempotency records remain bound to their original target and payload", async () => {
  assert.match(
    beginAction.toString(),
    /idempotencyKey:\s*input\.idempotencyKey/,
  );
  const actionsRoute = await readFile(
    new URL("../app/api/connections/[id]/actions/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(actionsRoute, /already bound to another action/);
  assert.match(actionsRoute, /sameActionRequest\(started\.record\.request/);
  assert.match(actionsRoute, /started\.record\.requestedBy !== auth\.actor/);
});

test("action equality survives JSONB key reordering without ignoring changed values", () => {
  assert(sameActionRequest(
    { type: "message", agentId: "main", input: "hello", nested: { b: 2, a: 1 } },
    { input: "hello", nested: { a: 1, b: 2 }, agentId: "main", type: "message" },
  ));
  assert(!sameActionRequest({ input: "one" }, { input: "two" }));
  assert(!sameActionRequest({ steps: [1, 2] }, { steps: [2, 1] }));
  assert.equal(canRetryAction("hermes", "message"), false);
  assert.equal(canRetryAction("openclaw", "message"), true);
  assert.equal(canRetryAction("openclaw", "stop"), false);
});

test("invalid bearer credentials cannot fall back to a signed cookie", async () => {
  process.env.NERVE_SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.NERVE_ADMIN_TOKEN = "test-admin-key-with-at-least-24-characters";
  process.env.NERVE_PUBLIC_URL = "https://nerve.example";
  const cookie = `nerve_session=${issueSessionCookieValue()}`;
  for (const authorization of ["Bearer invalid", "Basic invalid", ""]) {
    const result = await requireApiAuth(new Request("https://nerve.example/api/connections", {
      method: "POST", headers: { authorization, cookie, origin: "https://attacker.example" },
    }));
    assert(result instanceof Response);
    assert.equal(result.status, 401);
  }
  const crossOrigin = await requireApiAuth(new Request("https://nerve.example/api/connections", {
    method: "POST", headers: { cookie, origin: "http://nerve.example" },
  }));
  assert(crossOrigin instanceof Response);
  assert.equal(crossOrigin.status, 403);
  // Valid cookie authentication, including database revocation, is tested in integration.
});

test("origin checks use the configured origin and ignore spoofed forwarding headers", () => {
  process.env.NERVE_PUBLIC_URL = "https://nerve.example";
  assert.equal(isSameOrigin(new Request("http://localhost/api", {
    headers: { origin: "https://attacker.example", "x-forwarded-host": "attacker.example" },
  })), false);
  assert.equal(isSameOrigin(new Request("http://localhost/api", {
    headers: { origin: "https://nerve.example" },
  })), true);
});

test("sessions are unique and invalidate when keys or workspaces change", () => {
  process.env.NERVE_SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  const key = { actor: "alice", role: "admin" as const, workspaceId: "research", token: "test-key-with-at-least-24-characters" };
  process.env.NERVE_ACCESS_KEYS = JSON.stringify([key]);
  const context = authenticateAccessKey(key.token)!;
  assert.equal(context.workspaceId, "research");
  const first = issueSessionCookieValue(context);
  assert.notEqual(first, issueSessionCookieValue(context));
  process.env.NERVE_ACCESS_KEYS = JSON.stringify([{ ...key, token: `${key.token}-rotated` }]);
  assert.equal(sessionContext(first), null);
  process.env.NERVE_ACCESS_KEYS = JSON.stringify([{ ...key, workspaceId: "other" }]);
  assert.equal(sessionContext(first), null);
  process.env.NERVE_ACCESS_KEYS = JSON.stringify([{ ...key, role: "viewer" }]);
  assert.equal(sessionContext(first), null);
});

test("queued delivery rechecks current actor permissions and workspace", () => {
  delete process.env.NERVE_ADMIN_TOKEN;
  const key = { actor: "alice", role: "operator", workspaceId: "research", token: "test-key-with-at-least-24-characters" };
  process.env.NERVE_ACCESS_KEYS = JSON.stringify([key]);
  assert.equal(actorCanDispatch("alice", "research", "message"), true);
  assert.equal(actorCanDispatch("alice", "research", "approve"), false);
  assert.equal(actorCanDispatch("alice", "other", "message"), false);
  assert.equal(actorCanDispatch("alice", "research", "unknown"), false);
  process.env.NERVE_ACCESS_KEYS = JSON.stringify([{ ...key, role: "viewer" }]);
  assert.equal(actorCanDispatch("alice", "research", "message"), false);
  process.env.NERVE_ACCESS_KEYS = "[]";
  assert.equal(actorCanDispatch("alice", "research", "message"), false);
});
test("login identity trusts only an explicitly configured ingress header", () => {
  const request = new Request("https://nerve.example", { headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" } });
  delete process.env.NERVE_TRUSTED_IP_HEADER;
  assert.equal(loginClientKey(request), "shared-ingress");
  process.env.NERVE_TRUSTED_IP_HEADER = "x-forwarded-for";
  assert.equal(loginClientKey(request), "203.0.113.10");
  assert.equal(loginClientKey(new Request("https://nerve.example", { headers: { "x-forwarded-for": "spoofed" } })), "shared-ingress");
});

test("mission targets are bounded, unique, and validated", () => {
  const target = { connectionId: "11111111-1111-1111-1111-111111111111", agentId: "main" };
  assert.deepEqual(missionTargets([target]), [target]);
  for (const value of [null, [], [target, target], [{ ...target, connectionId: "invalid" }],
    [{ ...target, agentId: "" }], Array.from({ length: 26 }, (_, index) => ({ ...target, agentId: String(index) }))]) {
    assert.equal(missionTargets(value), null);
  }
});

test("IPv6 literals and mapped private/metadata addresses follow the same policy", async () => {
  process.env.NERVE_ALLOW_PRIVATE_NETWORKS = "false";
  for (const address of ["::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "fd00::1"]) {
    await assert.rejects(assertSafeRuntimeEndpoint(`https://[${address}]`, "hermes"), /Private runtime addresses/);
  }
  for (const allow of ["false", "true"]) {
    process.env.NERVE_ALLOW_PRIVATE_NETWORKS = allow;
    for (const address of ["fe80::1", "::ffff:169.254.169.254"]) {
      await assert.rejects(assertSafeRuntimeEndpoint(`https://[${address}]`, "hermes"), /metadata/);
    }
  }
  assert.equal(await assertSafeRuntimeEndpoint("http://[::1]:8080/v1", "hermes"), "http://[::1]:8080");
});
