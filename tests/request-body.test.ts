import assert from "node:assert/strict";
import test from "node:test";
import { readJsonObject } from "../lib/request-body";
import { readRuntimeJson } from "../lib/runtime-response";
import { requestJson } from "../lib/client-api";

function request(body: string, headers?: HeadersInit) {
  return new Request("http://localhost/api", { method: "POST", body, headers });
}

test("bounded JSON accepts objects and rejects malformed or non-object bodies", async () => {
  assert.deepEqual(await readJsonObject(request('{"hello":"world"}'), 100), { hello: "world" });
  for (const body of ["null", "[]", "true", '"text"', "{", ""]) {
    const result = await readJsonObject(request(body), 100);
    assert(result instanceof Response);
    assert.equal(result.status, 400);
  }
});

test("body limits count UTF-8 bytes even when Content-Length is missing or false", async () => {
  for (const headers of [undefined, { "content-length": "1" }]) {
    const result = await readJsonObject(request('{"value":"ééé"}', headers), 15);
    assert(result instanceof Response);
    assert.equal(result.status, 413);
  }
  assert.deepEqual(await readJsonObject(request('{"a":1}'), 7), { a: 1 });
});

test("oversized streamed bodies are cancelled before their remaining chunks are read", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(32)); },
    cancel() { cancelled = true; },
  });
  const streamed = new Request("http://localhost/api", {
    method: "POST", body, duplex: "half",
  } as RequestInit);
  const result = await readJsonObject(streamed, 16);
  assert(result instanceof Response);
  assert.equal(result.status, 413);
  assert(cancelled);
});

test("runtime responses are bounded and reject malformed JSON", async () => {
  assert.deepEqual(await readRuntimeJson(new Response('{"ok":true}')), { ok: true });
  await assert.rejects(readRuntimeJson(new Response("<html>bad gateway</html>")), /invalid JSON/);
  await assert.rejects(readRuntimeJson(new Response(" ".repeat(1_048_577))), /1 MiB limit/);
});

test("client treats HTTP 202 errors as unknown outcomes, never successful commands", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ error: "Outcome unknown", state: "unknown" }, { status: 202 });
  await assert.rejects(requestJson("/api/actions"), /Outcome unknown/);
  globalThis.fetch = async () => Response.json({ result: { run_id: "run-1" } });
  assert.deepEqual(await requestJson("/api/actions"), { result: { run_id: "run-1" } });
  globalThis.fetch = async () => new Response("<html>not JSON</html>");
  await assert.rejects(requestJson("/api/actions"), /invalid response/);
});
