import { cookies } from "next/headers";
import {
  authConfiguration,
  authenticateAccessKey,
  issueSessionCookieValue,
  currentSession,
  isSameOrigin,
  sessionCookie,
  revokeSession,
} from "../../../../lib/auth";
import { claimLoginAttempt, loginClientKey } from "../../../../lib/rate-limit";
import { readJsonObject } from "../../../../lib/request-body";

export const runtime = "nodejs";

export async function GET() {
  const configuration = authConfiguration();
  const context = await currentSession();
  return Response.json({
    configured: configuration.configured,
    authenticated: Boolean(context),
    ...(context ?? {}),
  });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const configuration = authConfiguration();
  if (!configuration.configured) {
    return Response.json(
      { error: "Nerve authentication is not configured." },
      { status: 503 },
    );
  }
  const body = await readJsonObject(request, 8_192);
  if (body instanceof Response) return body;
  if (!(await claimLoginAttempt(loginClientKey(request)))) {
    return Response.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "retry-after": "900" } },
    );
  }
  const context = body && typeof body.token === "string"
    ? authenticateAccessKey(body.token)
    : null;
  if (!context) {
    return Response.json({ error: "Invalid access key." }, { status: 401 });
  }
  const store = await cookies();
  await revokeSession(store.get(sessionCookie.name)?.value);
  store.set(sessionCookie.name, issueSessionCookieValue(context, Date.now(), String(body.token)), sessionCookie.options);
  return Response.json({ authenticated: true, ...context });
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const store = await cookies();
  await revokeSession(store.get(sessionCookie.name)?.value);
  store.set(sessionCookie.name, "", { ...sessionCookie.options, maxAge: 0 });
  return Response.json({ authenticated: false });
}
