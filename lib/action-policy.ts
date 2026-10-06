import { isDeepStrictEqual } from "node:util";
import type { RuntimeKind } from "./adapters/types";

/** JSONB does not preserve object key order; compare values, not serialization. */
export function sameActionRequest(
  stored: Record<string, unknown>,
  requested: Record<string, unknown>,
): boolean {
  return isDeepStrictEqual(stored, requested);
}

/** Only chat.send currently forwards an idempotency key to its runtime. */
export function canRetryAction(runtime: RuntimeKind, action: string): boolean {
  return runtime === "openclaw" && action === "message";
}
