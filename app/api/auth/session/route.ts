import { cookies } from "next/headers";
import {
  authConfiguration,
  authenticateAccessKey,
  issueSessionCookieValue,
  isAuthenticated,
  sessionCookie,
} from "../../../../lib/auth";
import {
  clearLoginFailures,
  isLoginRateLimited,
  recordLoginFailure,
} from "../../../../lib/rate-limit";

export const runtime = "nodejs";

function clientKey(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  ).slice(0, 128);
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
  if (await isLoginRateLimited(key)) {
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
  const context = body && typeof body.token === "string"
    ? authenticateAccessKey(body.token)
    : null;
  if (!context) {
    await recordLoginFailure(key);
    return Response.json({ error: "Invalid access key." }, { status: 401 });
  }
  await clearLoginFailures(key);
  const store = await cookies();
  store.set(sessionCookie.name, issueSessionCookieValue(context), sessionCookie.options);
  return Response.json({ authenticated: true, actor: context.actor, role: context.role });
}

export async function DELETE() {
  const store = await cookies();
  store.set(sessionCookie.name, "", { ...sessionCookie.options, maxAge: 0 });
  return Response.json({ authenticated: false });
}
