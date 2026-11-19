import { NextResponse } from "next/server";
import { decide } from "./lib/gate.mjs";
import { spendingPath } from "./lib/spending-href.mjs";

export async function middleware(request: Request) {
  const url = new URL(request.url);
  if (url.pathname === "/finance/categories" || (url.pathname.startsWith("/finance/categories/") && !url.pathname.slice("/finance/categories/".length).includes("/"))) {
    const search: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      search[key] = value;
    });
    const slug = url.pathname === "/finance/categories" ? "" : decodeURIComponent(url.pathname.slice("/finance/categories/".length));
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host;
    const target = new URL(spendingPath(search, slug || undefined), `http://${host}`);
    return new NextResponse(null, { status: 308, headers: { location: target.toString() } });
  }
  const decision = await decide(request, process.env, Date.now());
  if (decision.type === "next") return NextResponse.next();
  if (decision.type === "redirect" && "location" in decision && typeof decision.location === "string") {
    return NextResponse.redirect(new URL(decision.location, request.url));
  }
  const status = "status" in decision && typeof decision.status === "number" ? decision.status : 503;
  const body = "body" in decision ? decision.body : { detail: "unavailable" };
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
