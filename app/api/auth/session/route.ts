import { cookies } from "next/headers";
import {
  authConfiguration,
  issueSessionCookieValue,
  isAuthenticated,
  sessionCookie,
  verifyAdminToken,
} from "../../../../lib/auth";

export const runtime = "nodejs";

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function clientKey(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  ).slice(0, 128);
}

function rateLimited(key: string): boolean {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
    return false;
  }
  return current.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string) {
  const current = attempts.get(key);
  if (current) current.count += 1;
  if (attempts.size > 10_000) {
    const now = Date.now();
    for (const [candidate, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(candidate);
    }
  }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function GET() {
  const configuration = authConfiguration();
  return Response.json({
    configured: configuration.configured,
    authenticated: configuration.configured ? await isAuthenticated() : false,
  });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8_192) {
    return Response.json({ error: "Request is too large." }, { status: 413 });
  }
  if (!sameOrigin(request)) {
    return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const key = clientKey(request);
  if (rateLimited(key)) {
    return Response.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "retry-after": "900" } },
    );
  }
  const configuration = authConfiguration();
  if (!configuration.configured) {
    return Response.json(
      { error: "Nerve authentication is not configured." },
      { status: 503 },
    );
  }
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  if (!body || typeof body.token !== "string" || !verifyAdminToken(body.token)) {
    recordFailure(key);
    return Response.json({ error: "Invalid access key." }, { status: 401 });
  }
  attempts.delete(key);
  const store = await cookies();
  store.set(sessionCookie.name, issueSessionCookieValue(), sessionCookie.options);
  return Response.json({ authenticated: true });
}

export async function DELETE() {
  const store = await cookies();
  store.set(sessionCookie.name, "", { ...sessionCookie.options, maxAge: 0 });
  return Response.json({ authenticated: false });
}
