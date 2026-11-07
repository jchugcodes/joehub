import { NextResponse } from "next/server";
import { readAuthConfig } from "../../../../lib/auth-config.mjs";
import { publicOrigin, clientIp } from "../../../../lib/client-ip.mjs";
import { beginOidc } from "../../../../lib/oidc.mjs";
import { jsonResult } from "../../../../lib/respond";
import { loginLimiter, store } from "../../../../lib/store.mjs";
import { StoreError } from "../../../../lib/store-upstash.mjs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = readAuthConfig(process.env);
  if (!config.ok || config.mode !== "oidc") {
    return jsonResult({ status: 503, body: { detail: "unavailable" } });
  }
  try {
    if (!(await loginLimiter.allow(clientIp(request), Date.now()))) {
      return jsonResult({ status: 429, body: { detail: "rate limit" } });
    }
  } catch {
    return jsonResult({ status: 503, body: { detail: "unavailable" } });
  }
  const origin = publicOrigin(request, process.env);
  if (!origin) return jsonResult({ status: 503, body: { detail: "unavailable" } });
  try {
    const url = await beginOidc(config, store, `${origin}/api/auth/callback`, Date.now());
    return NextResponse.redirect(url);
  } catch (error) {
    if (error instanceof StoreError || error) return jsonResult({ status: 503, body: { detail: "unavailable" } });
    return jsonResult({ status: 503, body: { detail: "unavailable" } });
  }
}
