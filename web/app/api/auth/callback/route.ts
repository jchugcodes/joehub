import { NextResponse } from "next/server";
import { readAuthConfig } from "../../../../lib/auth-config.mjs";
import { publicOrigin } from "../../../../lib/client-ip.mjs";
import { completeOidc, OIDC_COOKIE, readOidcCookie } from "../../../../lib/oidc.mjs";
import { jsonResult, sessionCookie } from "../../../../lib/respond";
import { newOwnerSession, seal } from "../../../../lib/sessions.mjs";
import { store } from "../../../../lib/store.mjs";
import { StoreError } from "../../../../lib/store-upstash.mjs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = readAuthConfig(process.env);
  if (!config.ok || config.mode !== "oidc") {
    return jsonResult({ status: 503, body: { detail: "unavailable" } });
  }
  const origin = publicOrigin(request, process.env);
  if (!origin) return jsonResult({ status: 503, body: { detail: "unavailable" } });
  const url = new URL(request.url);
  try {
    const result = await completeOidc({
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      browser: readOidcCookie(request.headers.get("cookie")),
      config,
      store,
      redirectUri: `${origin}/api/auth/callback`,
      now: Date.now(),
    });
    if (result.status !== 200) {
      const rejected = jsonResult({ status: result.status, body: { detail: result.error } });
      rejected.cookies.set(OIDC_COOKIE, "", { ...sessionCookie, maxAge: 0 });
      return rejected;
    }
    const now = Date.now();
    const session = newOwnerSession(result.claims.sub, now);
    await store.putSession(session, now);
    const response = NextResponse.redirect(new URL("/", origin));
    response.cookies.set("joehub_session", seal(config.secret, session.id), sessionCookie);
    response.cookies.set(OIDC_COOKIE, "", { ...sessionCookie, maxAge: 0 });
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof StoreError || error) return jsonResult({ status: 503, body: { detail: "unavailable" } });
    return jsonResult({ status: 503, body: { detail: "unavailable" } });
  }
}
