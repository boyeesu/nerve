import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { rateLimitBuckets } from "../db/schema";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function keyHash(key: string): string {
  return createHash("sha256").update(`login:${key}`).digest("hex");
}

export async function isLoginRateLimited(key: string): Promise<boolean> {
  const [bucket] = await getDb()
    .select({ attempts: rateLimitBuckets.attempts, resetAt: rateLimitBuckets.resetAt })
    .from(rateLimitBuckets)
    .where(eq(rateLimitBuckets.keyHash, keyHash(key)))
    .limit(1);
  return Boolean(
    bucket && bucket.resetAt.getTime() > Date.now() && bucket.attempts >= MAX_ATTEMPTS,
  );
}

export async function recordLoginFailure(key: string): Promise<void> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + WINDOW_MS);
  await getDb()
    .insert(rateLimitBuckets)
    .values({ keyHash: keyHash(key), attempts: 1, resetAt, updatedAt: now })
    .onConflictDoUpdate({
      target: rateLimitBuckets.keyHash,
      set: {
        attempts: sql<number>`case when ${rateLimitBuckets.resetAt} <= now() then 1 else ${rateLimitBuckets.attempts} + 1 end`,
        resetAt: sql<Date>`case when ${rateLimitBuckets.resetAt} <= now() then ${resetAt} else ${rateLimitBuckets.resetAt} end`,
        updatedAt: now,
      },
    });
}

export async function clearLoginFailures(key: string): Promise<void> {
  await getDb()
    .delete(rateLimitBuckets)
    .where(eq(rateLimitBuckets.keyHash, keyHash(key)));
}

export const loginRateLimitPolicy = { windowMs: WINDOW_MS, maxAttempts: MAX_ATTEMPTS };
