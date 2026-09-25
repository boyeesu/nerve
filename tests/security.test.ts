import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  authenticateAccessKey,
  hasPermission,
  issueSessionCookieValue,
  sessionContext,
} from "../lib/auth";
import { beginAction } from "../lib/store";
import { decryptJson, encryptJson } from "../lib/crypto";
import { assertSafeRuntimeEndpoint } from "../lib/network-policy";

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
  assert.match(actionsRoute, /JSON\.stringify\(started\.record\.request\)/);
});
