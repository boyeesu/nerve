import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const base = process.env.NERVE_TEST_BASE_URL;
if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Disposable local test server required.");
const { chromium } = await import(pathToFileURL(process.env.NERVE_PLAYWRIGHT_MODULE).href);
let deliveries = 0;
const runtime = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/v1/capabilities") response.end('{"model":"Browser fixture agent"}');
  else if (request.url === "/health/detailed") response.end('{"status":"ok"}');
  else if (request.url === "/v1/runs" && request.method === "GET") response.end("[]");
  else if (request.url === "/v1/runs" && request.method === "POST") {
    deliveries++;
    response.end(JSON.stringify({ run_id: `browser-run-${deliveries}` }));
  } else if (request.url?.endsWith("/events")) {
    response.setHeader("content-type", "text/event-stream");
    response.end('id: 1\ndata: {"seq":1,"event":"message.delta","delta":"Visible runtime reply"}\n\nid: 2\ndata: {"seq":2,"event":"run.completed"}\n\n');
  } else if (request.url?.startsWith("/v1/runs/")) response.end('{"status":"completed","output":"Visible runtime reply","session_id":"browser-session"}');
  else { response.statusCode = 404; response.end("{}"); }
});
await new Promise((resolve) => runtime.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.NERVE_TEST_BROWSER_EXECUTABLE
  ? { executablePath: process.env.NERVE_TEST_BROWSER_EXECUTABLE } : {}) });
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
let connectionId;
let missionId;
const headers = { authorization: `Bearer ${process.env.NERVE_TEST_ADMIN_TOKEN}`, "content-type": "application/json" };
async function api(path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  assert(response.ok, await response.clone().text());
  return response.status === 204 ? {} : response.json();
}
try {
  const { connection } = await api("/api/connections", { method: "POST", body: JSON.stringify({
    name: "Browser fixture", runtime: "hermes", endpoint: `http://127.0.0.1:${runtime.address().port}`, token: "browser-runtime-fixture",
  }) });
  connectionId = connection.id;
  await page.goto(base);
  await page.getByLabel("Nerve access key", { exact: true }).fill(process.env.NERVE_TEST_ADMIN_TOKEN);
  await page.getByRole("button", { name: "Open command center" }).click();
  await page.getByRole("heading", { name: /Agent command center/ }).waitFor();
  await page.getByRole("button", { name: "Saved missions", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Saved missions" });
  await dialog.waitFor();
  await dialog.getByLabel("Mission name").fill("Browser saved mission");
  await dialog.getByLabel("Command", { exact: true }).fill("Verify visible runtime output.");
  await dialog.getByRole("button", { name: "Select fleet (up to 25)" }).click();
  await dialog.getByRole("button", { name: "Save mission" }).click();
  await dialog.getByRole("heading", { name: "Browser saved mission" }).waitFor();
  const saved = await api("/api/missions");
  missionId = saved.missions.find((mission) => mission.name === "Browser saved mission").id;
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Launch to 1 agents" }).click();
  await dialog.getByText(/1 target receipts/).waitFor();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByText("Visible runtime reply", { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Continue in this session (new run)" }).click();
  await page.getByText(/Continuing session browser-session/).waitFor();
  assert.equal(deliveries, 1);
  await page.getByRole("button", { name: "Saved missions", exact: true }).click();
  await dialog.getByRole("heading", { name: "Browser saved mission" }).waitFor();
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Check / retry same launch" }).click();
  await dialog.getByText(/1 target receipts/).waitFor();
  assert.equal(deliveries, 1, "Reopening the mission dialog must retain the original launch identity.");
  await page.reload();
  await page.getByRole("button", { name: "Saved missions", exact: true }).click();
  await dialog.getByRole("button", { name: "Check / retry same launch" }).waitFor();
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Check / retry same launch" }).click();
  await dialog.getByText(/1 target receipts/).waitFor();
  assert.equal(deliveries, 1, "Reloading the page must not generate a new mission launch.");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await mkdir("outputs", { recursive: true });
  await page.screenshot({ path: "outputs/completion-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator(".topbar").count(), 1);
  await page.screenshot({ path: "outputs/completion-mobile.png" });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile document must not overflow.");
  await page.getByLabel("Runtime output and delivery history").scrollIntoViewIfNeeded();
  await page.getByText("Visible runtime reply", { exact: true }).first().waitFor();
  await page.screenshot({ path: "outputs/completion-mobile-output.png" });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Open command center" }).waitFor();
  await page.getByLabel("Nerve access key", { exact: true }).fill(process.env.NERVE_TEST_VIEWER_TOKEN);
  await page.getByRole("button", { name: "Open command center" }).click();
  await page.getByRole("heading", { name: /Agent command center/ }).waitFor();
  await page.getByRole("button", { name: "Saved missions", exact: true }).click();
  await dialog.getByRole("heading", { name: "Browser saved mission" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: /Launch to|Save mission|Delete/ }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("Browser smoke passed: missions, queued delivery, real output, continuation, modal keyboard close, mobile width, logout, viewer restrictions.");
} finally {
  if (missionId) await api(`/api/missions/${missionId}`, { method: "DELETE" });
  if (connectionId) await api(`/api/connections/${connectionId}`, { method: "DELETE" });
  await browser.close();
  await new Promise((resolve) => runtime.close(resolve));
}
