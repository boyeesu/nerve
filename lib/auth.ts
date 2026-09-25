import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

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

export type AuthContext = { actor: string; role: NerveRole };

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
    if (
      actor &&
      token.length >= 24 &&
      (role === "viewer" || role === "operator" || role === "admin")
    ) {
      keys.push({ actor, role, token });
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
    if (safeEqual(candidate, key.token)) return { actor: key.actor, role: key.role };
  }
  return null;
}

export function verifyAdminToken(candidate: string): boolean {
  return authenticateAccessKey(candidate)?.role === "admin";
}

export function issueSessionCookieValue(
  context: AuthContext = { actor: "legacy-admin", role: "admin" },
  now = Date.now(),
): string {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const actor = Buffer.from(context.actor, "utf8").toString("base64url");
  const payload = `v2.${expiresAt}.${actor}.${context.role}`;
  return `${payload}.${signature(payload)}`;
}

export function sessionContext(
  value: string | undefined,
  now = Date.now(),
): AuthContext | null {
  if (!value) return null;
  const [version, expiresAtRaw, actorEncoded, role, suppliedSignature, extra] = value.split(".");
  if (
    version !== "v2" ||
    !expiresAtRaw ||
    !actorEncoded ||
    !suppliedSignature ||
    extra ||
    (role !== "viewer" && role !== "operator" && role !== "admin")
  ) {
    return null;
  }
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return null;
  const payload = `${version}.${expiresAtRaw}.${actorEncoded}.${role}`;
  if (!safeEqual(suppliedSignature, signature(payload))) return null;
  const actor = Buffer.from(actorEncoded, "base64url").toString("utf8").trim().slice(0, 128);
  return actor ? { actor, role } : null;
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

export function permissionDenied(): Response {
  return Response.json({ error: "Your Nerve role cannot perform this action." }, { status: 403 });
}

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifySessionCookieValue(store.get(COOKIE_NAME)?.value);
}

export async function requireApiAuth(
  request: Request,
  permission: NervePermission = "read",
): Promise<AuthContext | Response> {
  const bearer = request.headers.get("authorization");
  let context: AuthContext | null = null;
  if (bearer?.startsWith("Bearer ")) {
    context = authenticateAccessKey(bearer.slice(7));
  }

  if (!context) {
    const cookieHeader = request.headers.get("cookie") ?? "";
    const session = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1);
    context = sessionContext(session);
  }
  if (!context) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!hasPermission(context, permission)) return permissionDenied();

  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !bearer) {
    const origin = request.headers.get("origin");
    const forwardedHost = request.headers.get("x-forwarded-host");
    const host = forwardedHost ?? request.headers.get("host");
    let matches = false;
    try {
      matches = Boolean(origin && host && new URL(origin).host === host);
    } catch {
      matches = false;
    }
    if (!matches) {
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
