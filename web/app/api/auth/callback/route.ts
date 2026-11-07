import { NextResponse } from "next/server";
import { readAuthConfig } from "../../../../lib/auth-config.mjs";
import { publicOrigin } from "../../../../lib/client-ip.mjs";
import { completeOidc } from "../../../../lib/oidc.mjs";
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
      config,
      store,
      redirectUri: `${origin}/api/auth/callback`,
      now: Date.now(),
    });
    if (result.status !== 200) return jsonResult({ status: result.status, body: { detail: result.error } });
    const now = Date.now();
    const session = newOwnerSession(result.claims.sub, now);
    await store.putSession(session, now);
    const response = NextResponse.redirect(new URL("/", origin));
    response.cookies.set("joehub_session", seal(config.secret, session.id), sessionCookie);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof StoreError || error) return jsonResult({ status: 503, body: { detail: "unavailable" } });
    return jsonResult({ status: 503, body: { detail: "unavailable" } });
  }
}
