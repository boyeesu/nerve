import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (relativePath) => readFile(new URL(relativePath, root), "utf8");

test("ships the Nerve command center and connection workflow", async () => {
  const [page, layout, styles] = await Promise.all([
    read("app/page.tsx"),
    read("app/layout.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(layout, /Nerve — Agent Command Center/);
  assert.match(page, /Connect an agent runtime/);
  assert.match(page, /OpenClaw Gateway/);
  assert.match(page, /Hermes API server/);
  assert.match(page, /AGENT SKILLS/);
  assert.match(page, /nerve-logo\.png/);
  assert.match(styles, /\.connectModal/);
  assert.match(styles, /\.skillsPanel/);
  assert.doesNotMatch(page, /codex-preview/);
});

test("keeps runtime credentials behind authenticated server routes", async () => {
  const [connectionsRoute, auth, crypto, store] = await Promise.all([
    read("app/api/connections/route.ts"),
    read("lib/auth.ts"),
    read("lib/crypto.ts"),
    read("lib/store.ts"),
  ]);

  assert.match(connectionsRoute, /requireApiAuth/);
  assert.match(connectionsRoute, /assertSafeRuntimeEndpoint/);
  assert.match(auth, /httpOnly: true/);
  assert.match(auth, /sameSite: "strict"/);
  assert.match(crypto, /aes-256-gcm/);
  assert.match(store, /encryptedCredentials/);
  assert.doesNotMatch(store, /console\.log/);
});

test("implements both runtime adapters and auditable actions", async () => {
  const [openclaw, hermes, actions, schema] = await Promise.all([
    read("lib/adapters/openclaw.ts"),
    read("lib/adapters/hermes.ts"),
    read("app/api/connections/[id]/actions/route.ts"),
    read("db/schema.ts"),
  ]);

  assert.match(openclaw, /PROTOCOL_VERSION = 4/);
  assert.match(openclaw, /"agents\.list"/);
  assert.match(openclaw, /"skills\.install"/);
  assert.match(openclaw, /"chat\.send"/);
  assert.match(hermes, /"\/v1\/capabilities"/);
  assert.match(hermes, /"\/v1\/runs"/);
  assert.match(hermes, /"\/v1\/skills"/);
  assert.match(actions, /idempotency-key/i);
  assert.match(schema, /actionRequests/);
  assert.match(schema, /auditEvents/);
});

test("contains a Railway production contract", async () => {
  const [railwaySource, dockerfile, environment, migration] = await Promise.all([
    read("railway.json"),
    read("Dockerfile"),
    read(".env.example"),
    read("drizzle/0000_harsh_namora.sql"),
  ]);
  const railway = JSON.parse(railwaySource);

  assert.equal(railway.build.builder, "DOCKERFILE");
  assert.equal(railway.deploy.healthcheckPath, "/api/health");
  assert.deepEqual(railway.deploy.preDeployCommand, ["npm run db:migrate"]);
  assert.match(dockerfile, /USER nextjs/);
  assert.match(dockerfile, /node_modules\/postgres/);
  assert.match(environment, /NERVE_ENCRYPTION_KEY=/);
  assert.match(environment, /NERVE_SESSION_SECRET=/);
  assert.match(environment, /NERVE_ADMIN_TOKEN=/);
  assert.match(migration, /CREATE TABLE "connections"/);
  await access(new URL("docs/RAILWAY.md", root));
  await access(new URL("docs/CONNECTIONS.md", root));
  await access(new URL("docs/PRODUCTION.md", root));
});
