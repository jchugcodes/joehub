import { NextResponse } from "next/server";
import { decide } from "./lib/gate.mjs";

export async function middleware(request: Request) {
  const decision = await decide(request, process.env, Date.now());
  if (decision.type === "next") return NextResponse.next();
  if (decision.type === "redirect" && "location" in decision) {
    return NextResponse.redirect(new URL(decision.location, request.url));
  }
  const status = "status" in decision && typeof decision.status === "number" ? decision.status : 503;
  const body = "body" in decision ? decision.body : { detail: "unavailable" };
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
