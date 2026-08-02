import { hermesAdapter } from "./hermes";
import { openClawAdapter } from "./openclaw";
import type { RuntimeAdapter, RuntimeKind } from "./types";

export function runtimeAdapter(runtime: RuntimeKind): RuntimeAdapter {
  return runtime === "openclaw" ? openClawAdapter : hermesAdapter;
}

export * from "./types";
