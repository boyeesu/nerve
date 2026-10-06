import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { revokedSessions } from "../db/schema";

const COOKIE_NAME = "nerve_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export type NerveRole = "viewer" | "operator" | "admin";
export type NervePermission =
  | "read"
  | "connections.write"
  | "actions.message"
  | "actions.stop"
  | "approvals.write"
  | "skills.write";

export type AuthContext = { actor: string; role: NerveRole; workspaceId?: string };

export function validWorkspace(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
}

const ROLE_PERMISSIONS: Record<NerveRole, ReadonlySet<NervePermission>> = {
  viewer: new Set(["read"]),
  operator: new Set(["read", "actions.message", "actions.stop"]),
  admin: new Set([
    "read",
    "connections.write",
    "actions.message",
    "actions.stop",
    "approvals.write",
    "skills.write",
  ]),
};

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionSecret(): string {
  const value = process.env.NERVE_SESSION_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error("NERVE_SESSION_SECRET must be at least 32 characters.");
  }
  return value;
}

function signature(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function configuredAccessKeys(): Array<AuthContext & { token: string }> {
  const keys: Array<AuthContext & { token: string }> = [];
  const legacy = process.env.NERVE_ADMIN_TOKEN?.trim();
  if (legacy && legacy.length >= 24) {
    keys.push({ actor: "legacy-admin", role: "admin", token: legacy });
  }

  const source = process.env.NERVE_ACCESS_KEYS?.trim();
  if (!source) return keys;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return keys;
  }
  if (!Array.isArray(parsed)) return keys;
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const actor = typeof record.actor === "string" ? record.actor.trim().slice(0, 128) : "";
    const token = typeof record.token === "string" ? record.token.trim() : "";
    const role = record.role;
    const workspaceId = record.workspaceId ?? "default";
    if (
      actor &&
      token.length >= 24 &&
      validWorkspace(workspaceId) &&
      (role === "viewer" || role === "operator" || role === "admin")
    ) {
      keys.push({ actor, role, token, ...(workspaceId !== "default" ? { workspaceId } : {}) });
    }
  }
  return keys;
}

export function authConfiguration() {
  const keys = configuredAccessKeys();
  const secret = process.env.NERVE_SESSION_SECRET?.trim() ?? "";
  return {
    configured: keys.length > 0 && secret.length >= 32,
    tokenConfigured: keys.length > 0,
    sessionSecretConfigured: secret.length >= 32,
    accessKeyCount: keys.length,
  };
}

export function authenticateAccessKey(candidate: string): AuthContext | null {
  for (const key of configuredAccessKeys()) {
    if (safeEqual(candidate, key.token)) {
      return { actor: key.actor, role: key.role, ...(key.workspaceId ? { workspaceId: key.workspaceId } : {}) };
    }
  }
  return null;
}

export function verifyAdminToken(candidate: string): boolean {
  return authenticateAccessKey(candidate)?.role === "admin";
}

export function issueSessionCookieValue(
  context: AuthContext = { actor: "legacy-admin", role: "admin" },
  now = Date.now(),
  accessKey?: string,
): string {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const actor = Buffer.from(context.actor, "utf8").toString("base64url");
  const key = configuredAccessKeys().find((key) =>
    key.actor === context.actor && key.role === context.role &&
    (key.workspaceId ?? "default") === (context.workspaceId ?? "default") &&
    (accessKey === undefined || safeEqual(key.token, accessKey)));
  if (!key) throw new Error("Access key is no longer configured.");
  // Changing/removing a key, role or workspace invalidates its existing sessions.
  const fingerprint = createHmac("sha256", sessionSecret()).update(key.token).digest("base64url");
  const payload = `v3.${expiresAt}.${actor}.${context.role}.${context.workspaceId ?? "default"}.${fingerprint}.${randomUUID()}`;
  return `${payload}.${signature(payload)}`;
}

export function sessionContext(
  value: string | undefined,
  now = Date.now(),
): AuthContext | null {
  if (!value) return null;
  const [version, expiresAtRaw, actorEncoded, role, workspaceId, fingerprint, nonce, suppliedSignature, extra] = value.split(".");
  if (
    version !== "v3" ||
    !expiresAtRaw ||
    !actorEncoded ||
    !suppliedSignature ||
    extra ||
    !validWorkspace(workspaceId) || !fingerprint || !nonce ||
    (role !== "viewer" && role !== "operator" && role !== "admin")
  ) {
    return null;
  }
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return null;
  const payload = `${version}.${expiresAtRaw}.${actorEncoded}.${role}.${workspaceId}.${fingerprint}.${nonce}`;
  if (!safeEqual(suppliedSignature, signature(payload))) return null;
  const actor = Buffer.from(actorEncoded, "base64url").toString("utf8").trim().slice(0, 128);
  const configured = configuredAccessKeys().some((key) =>
    key.actor === actor && key.role === role && (key.workspaceId ?? "default") === workspaceId &&
    safeEqual(createHmac("sha256", sessionSecret()).update(key.token).digest("base64url"), fingerprint));
  return actor && configured ? { actor, role, ...(workspaceId !== "default" ? { workspaceId } : {}) } : null;
}

function sessionDigest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function activeSession(value: string | undefined): Promise<AuthContext | null> {
  const context = sessionContext(value);
  if (!context || !value) return null;
  const [revoked] = await getDb().select().from(revokedSessions)
    .where(eq(revokedSessions.digest, sessionDigest(value))).limit(1);
  return revoked ? null : context;
}

export async function revokeSession(value: string | undefined): Promise<void> {
  if (!value || !sessionContext(value)) return;
  await getDb().insert(revokedSessions).values({
    digest: sessionDigest(value),
    expiresAt: new Date(Number(value.split(".")[1]) * 1000),
  }).onConflictDoNothing();
}

export function verifySessionCookieValue(value: string | undefined): boolean {
  return Boolean(sessionContext(value));
}

export function hasPermission(
  context: AuthContext,
  permission: NervePermission,
): boolean {
  return ROLE_PERMISSIONS[context.role].has(permission);
}

/** Recheck queued work at dispatch, so revoked/downgraded actors cannot keep executing. */
export function actorCanDispatch(actor: string, workspaceId: string, action: string): boolean {
  const permission: NervePermission | undefined = action === "message" ? "actions.message"
    : action === "stop" ? "actions.stop" : action === "approve" ? "approvals.write" : undefined;
  return Boolean(permission && configuredAccessKeys().some((key) =>
    key.actor === actor && (key.workspaceId ?? "default") === workspaceId &&
    hasPermission(key, permission)));
}

export function permissionDenied(): Response {
  return Response.json({ error: "Your Nerve role cannot perform this action." }, { status: 403 });
}

export async function isAuthenticated(): Promise<boolean> {
  return Boolean(await currentSession());
}

export async function currentSession(): Promise<AuthContext | null> {
  if (!authConfiguration().configured) return null;
  const store = await cookies();
  return activeSession(store.get(COOKIE_NAME)?.value);
}

export function isSameOrigin(request: Request): boolean {
  try {
    const expected = new URL(process.env.NERVE_PUBLIC_URL ?? request.url);
    const origin = request.headers.get("origin");
    return Boolean(origin && new URL(origin).origin === expected.origin);
  } catch {
    return false;
  }
}

export async function requireApiAuth(
  request: Request,
  permission: NervePermission = "read",
): Promise<AuthContext | Response> {
  const bearer = request.headers.get("authorization");
  let context: AuthContext | null = null;
  if (bearer !== null) {
    // An invalid Authorization header must never bypass cookie CSRF checks.
    if (bearer.startsWith("Bearer ")) context = authenticateAccessKey(bearer.slice(7));
  } else if (authConfiguration().configured) {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !isSameOrigin(request)) {
      return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
    }
    const cookieHeader = request.headers.get("cookie") ?? "";
    const session = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1);
    context = await activeSession(session);
  }
  if (!context) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!hasPermission(context, permission)) return permissionDenied();

  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && bearer === null) {
    if (!isSameOrigin(request)) {
      return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
    }
  }
  return context;
}

export const sessionCookie = {
  name: COOKIE_NAME,
  options: {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  },
};
