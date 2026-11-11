import { devPagesOpen, productionLike, readAuthConfig } from "./auth-config.mjs";
import { isGatedPath, productionNav, TASKS_PATH } from "./live-pages.mjs";
import { readKeyPrefix } from "./keys.mjs";
import { openCookie } from "./seal.mjs";
import { createUpstashStore, StoreError } from "./store-upstash.mjs";

const PUBLIC = new Set(["/api/health", "/api/auth/login", "/api/auth/callback", "/api/session/login"]);

let upstash;

function storeFor(env) {
  const prefix = readKeyPrefix(env);
  if (!prefix.ok) return null;
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  if (!upstash) {
    upstash = createUpstashStore({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
      prefix: prefix.prefix,
    });
  }
  return upstash;
}

function denied(pathname) {
  if (pathname.startsWith("/api/")) return { type: "json", status: 401, body: { detail: "authentication required" } };
  return { type: "redirect", location: "/api/auth/login" };
}

function unavailable(pathname) {
  if (pathname.startsWith("/api/")) return { type: "json", status: 503, body: { detail: "unavailable" } };
  return { type: "json", status: 503, body: { detail: "unavailable" } };
}

export async function decide(request, env, now) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === "/api/health") return { type: "next" };
  if (productionNav(env) && !pathname.startsWith("/api/") && isGatedPath(pathname)) {
    return { type: "redirect", location: TASKS_PATH };
  }
  const config = readAuthConfig(env);
  if (!config.ok) return unavailable(pathname);
  if (PUBLIC.has(pathname)) return { type: "next" };
  if (!productionLike(env)) {
    if (!pathname.startsWith("/api/") && devPagesOpen(env)) return { type: "next" };
    if (!pathname.startsWith("/api/")) return denied(pathname);
    const cookie = cookieValue(request);
    if (!cookie) return denied(pathname);
    return { type: "next" };
  }
  const sessionId = await openCookie(config.secret, cookieValue(request));
  if (!sessionId) return denied(pathname);
  const store = storeFor(env);
  if (!store) return unavailable(pathname);
  try {
    const session = await store.getSession(sessionId, now);
    if (!session) return denied(pathname);
    return { type: "next" };
  } catch (error) {
    if (error instanceof StoreError || error) return unavailable(pathname);
    return unavailable(pathname);
  }
}

function cookieValue(request) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === "joehub_session") return part.slice(eq + 1).trim();
  }
  return "";
}
