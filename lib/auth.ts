import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "nerve_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function adminToken(): string | null {
  const value = process.env.NERVE_ADMIN_TOKEN?.trim() ?? "";
  return value.length >= 24 ? value : null;
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

export function authConfiguration() {
  const token = adminToken();
  const secret = process.env.NERVE_SESSION_SECRET?.trim() ?? "";
  return {
    configured: Boolean(token && secret.length >= 32),
    tokenConfigured: Boolean(token),
    sessionSecretConfigured: secret.length >= 32,
  };
}

export function verifyAdminToken(candidate: string): boolean {
  const expected = adminToken();
  return Boolean(expected && safeEqual(candidate, expected));
}

export function issueSessionCookieValue(now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `v1.${expiresAt}`;
  return `${payload}.${signature(payload)}`;
}

export function verifySessionCookieValue(value: string | undefined): boolean {
  if (!value) return false;
  const [version, expiresAtRaw, suppliedSignature] = value.split(".");
  if (version !== "v1" || !expiresAtRaw || !suppliedSignature) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return false;
  }
  const payload = `${version}.${expiresAtRaw}`;
  return safeEqual(suppliedSignature, signature(payload));
}

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifySessionCookieValue(store.get(COOKIE_NAME)?.value);
}

export async function requireApiAuth(
  request: Request,
): Promise<{ actor: string } | Response> {
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ") && verifyAdminToken(bearer.slice(7))) {
    return { actor: "api-token" };
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const session = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (!verifySessionCookieValue(session)) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
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
  return { actor: "operator" };
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
