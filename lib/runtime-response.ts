const MAX_RESPONSE_BYTES = 1_048_576;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Bound untrusted HTTP responses, even when Content-Length is absent or false. */
export async function readRuntimeJson(
  response: {
    body: {
      getReader(): {
        read(): Promise<{ done: boolean; value?: Uint8Array }>;
        cancel(): Promise<void>;
        releaseLock(): void;
      };
    } | null;
  },
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Runtime response exceeds the 1 MiB limit.");
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Runtime returned invalid JSON.");
    }
  } finally {
    reader.releaseLock();
  }
}
