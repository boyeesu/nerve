/** An accepted HTTP request can still have an unknown runtime outcome (202). */
export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(60_000),
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => null);
  if (response.status === 401 && path !== "/api/auth/session") {
    window.dispatchEvent(new Event("nerve-session-expired"));
  }
  if (!response.ok || (payload && typeof payload.error === "string")) {
    throw new Error(payload?.error ?? `Request failed (${response.status}).`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Nerve returned an invalid response. Refresh and try again.");
  }
  if (typeof payload.warning === "string") {
    window.dispatchEvent(new CustomEvent("nerve-operation-warning", { detail: payload.warning }));
  }
  return payload as T;
}
