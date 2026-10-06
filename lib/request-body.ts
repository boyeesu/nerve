/** Limit bytes actually read, including requests without a Content-Length header. */
export async function readJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown> | Response> {
  const tooLarge = () => Response.json({ error: "Request is too large." }, { status: 413 });
  if (Number(request.headers.get("content-length")) > maxBytes) return tooLarge();
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "A JSON object is required." }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return tooLarge();
      }
      chunks.push(value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return Response.json({ error: "A JSON object is required." }, { status: 400 });
    }
    return value as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON request." }, { status: 400 });
  } finally {
    reader.releaseLock();
  }
}
