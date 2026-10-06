import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";
import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const databaseUrl = process.env.NERVE_TEST_DATABASE_URL;
if (!databaseUrl || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Set NERVE_TEST_DATABASE_URL to a disposable local PostgreSQL database. This suite writes test data.");
}
const portServer = net.createServer();
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const admin = randomBytes(32).toString("hex");
const viewer = randomBytes(32).toString("hex");
const other = randomBytes(32).toString("hex");
const env = {
  ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL: "disable",
  NERVE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  NERVE_SESSION_SECRET: randomBytes(48).toString("base64"),
  NERVE_ADMIN_TOKEN: admin,
  NERVE_ACCESS_KEYS: JSON.stringify([
    { actor: "fixture-viewer", role: "viewer", token: viewer },
    { actor: "fixture-other", role: "admin", workspaceId: "other", token: other },
  ]),
  NERVE_PUBLIC_URL: `http://127.0.0.1:${port}`, HOSTNAME: "127.0.0.1", PORT: String(port),
  NERVE_ALLOW_PRIVATE_NETWORKS: "true", NERVE_WORKER_ENABLED: "true",
  NERVE_TRUSTED_IP_HEADER: "", NEXT_TELEMETRY_DISABLED: "1",
  NERVE_TEST_BASE_URL: `http://127.0.0.1:${port}`,
  NERVE_TEST_ADMIN_TOKEN: admin, NERVE_TEST_VIEWER_TOKEN: viewer, NERVE_TEST_OTHER_TOKEN: other,
};
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}).`)));
  });
}
await run(process.execPath, ["scripts/migrate.mjs"]);
// Repeated local rehearsals must not inherit a previous run's shared login budget.
// Only the explicitly opted-in disposable fixture database is modified.
const fixtureDb = postgres(databaseUrl, { max: 1, ssl: false });
try {
  await fixtureDb`delete from rate_limit_buckets where key_hash = ${createHash("sha256").update("login:shared-ingress").digest("hex")}`;
} finally { await fixtureDb.end(); }
const server = spawn(process.execPath, [".next/standalone/server.js"], { env, stdio: "inherit" });
server.once("error", (error) => console.error(error.message));
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw new Error("Integration server exited before becoming ready.");
    try {
      const response = await fetch(`${env.NERVE_TEST_BASE_URL}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for the local server, never an external deployment. */ }
    await delay(500);
  }
  if (!ready) throw new Error("Integration server did not become healthy.");
  await run("npm", ["test"]);
  if (process.env.NERVE_PLAYWRIGHT_MODULE) {
    await run(process.execPath, ["tests/browser-smoke.mjs"]);
  }
} finally {
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await Promise.race([exited, delay(5000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
