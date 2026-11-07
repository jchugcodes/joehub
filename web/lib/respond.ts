import { NextResponse } from "next/server";
import { clientIp as peerAddress } from "./client-ip.mjs";

const COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 14 * 24 * 60 * 60,
};

export function clientIp(
  request: Request,
  env: Record<string, string | undefined> = process.env,
  peer = "direct",
): string {
  return peerAddress(request, env, peer);
}

export function jsonResult(result: {
  status: number;
  body: unknown;
  cookie?: string;
  clearCookie?: boolean;
}) {
  const response = NextResponse.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
  if (result.cookie) response.cookies.set("joehub_session", result.cookie, COOKIE);
  if (result.clearCookie) {
    response.cookies.set("joehub_session", "", { ...COOKIE, maxAge: 0 });
  }
  return response;
}
