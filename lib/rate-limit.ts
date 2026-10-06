import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { getSqlClient } from "../db";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function loginClientKey(request: Request): string {
  // Only trust a header that the deployment's ingress explicitly overwrites.
  const header = process.env.NERVE_TRUSTED_IP_HEADER?.toLowerCase();
  if (!header || !["cf-connecting-ip", "x-real-ip", "x-forwarded-for"].includes(header)) return "shared-ingress";
  const value = request.headers.get(header)?.split(",")[0]?.trim() ?? "";
  return isIP(value) ? value : "shared-ingress";
}

/** One atomic upsert claims a slot, including for concurrent requests. */
export async function claimLoginAttempt(key: string): Promise<boolean> {
  const hash = createHash("sha256").update(`login:${key}`).digest("hex");
  const sql = getSqlClient();
  const rows = await sql`
    insert into rate_limit_buckets (key_hash, attempts, reset_at, updated_at)
    values (${hash}, 1, now() + interval '15 minutes', now())
    on conflict (key_hash) do update set
      attempts = case when rate_limit_buckets.reset_at <= now() then 1 else rate_limit_buckets.attempts + 1 end,
      reset_at = case when rate_limit_buckets.reset_at <= now() then now() + interval '15 minutes' else rate_limit_buckets.reset_at end,
      updated_at = now()
    where rate_limit_buckets.reset_at <= now() or rate_limit_buckets.attempts < ${MAX_ATTEMPTS}
    returning attempts`;
  return rows.length === 1;
}

export const loginRateLimitPolicy = { windowMs: WINDOW_MS, maxAttempts: MAX_ATTEMPTS };
