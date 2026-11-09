import { readKeyPrefix } from "./keys.mjs";

const OIDC_KEYS = ["JOEHUB_OIDC_ISSUER", "JOEHUB_OIDC_CLIENT_ID", "JOEHUB_OIDC_CLIENT_SECRET"];
const UPSTASH_KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];

export function isBuild(env) {
  const phase = String(env.NEXT_PHASE || "");
  const life = String(env.npm_lifecycle_event || "");
  return phase.includes("build") || life === "build";
}

export function productionLike(env) {
  return (
    env.JOEHUB_API_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.VERCEL_ENV === "production" ||
    env.VERCEL_ENV === "preview"
  );
}

export function devAuthEnabled(env) {
  return env.JOEHUB_DEV_AUTH === "1" || env.JOEHUB_FAKE_AUTH === "1";
}

export function devPagesOpen(env) {
  return devAuthEnabled(env) && !productionLike(env);
}

function present(env, name) {
  return String(env[name] || "").trim();
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function httpUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export function readAuthConfig(env) {
  if (isBuild(env)) return { ok: true, mode: "build" };
  const prefix = readKeyPrefix(env);
  if (!prefix.ok) return { ok: false, error: "invalid key prefix" };
  if (productionLike(env) && devAuthEnabled(env)) {
    return { ok: false, error: "production forbids dev auth and requires a session secret" };
  }
  const secret = present(env, "JOEHUB_SESSION_SECRET");
  if (productionLike(env) && secret.length < 16) {
    return { ok: false, error: "production forbids dev auth and requires a session secret" };
  }
  const vercelEnv = present(env, "VERCEL_ENV");
  if (vercelEnv === "production" || vercelEnv === "preview" || vercelEnv === "development") {
    if (present(env, "JOEHUB_ENV_SCOPE") !== vercelEnv) {
      return { ok: false, error: "env scope does not match VERCEL_ENV" };
    }
  }
  const oidcSet = OIDC_KEYS.filter((name) => present(env, name));
  const upstashSet = UPSTASH_KEYS.filter((name) => present(env, name));
  const partial = oidcSet.length > 0 || upstashSet.length > 0;
  const onVercel = vercelEnv === "production" || vercelEnv === "preview";
  if (productionLike(env) || partial) {
    if (oidcSet.length !== OIDC_KEYS.length || upstashSet.length !== UPSTASH_KEYS.length) {
      return { ok: false, error: "missing auth configuration" };
    }
    const issuer = present(env, "JOEHUB_OIDC_ISSUER").replace(/\/$/, "");
    const issuerOk = onVercel ? httpsUrl(issuer) : httpUrl(issuer);
    if (!issuerOk) return { ok: false, error: "missing auth configuration" };
    const ownerEmail = present(env, "JOEHUB_OWNER_EMAIL").toLowerCase();
    const ownerSub = present(env, "JOEHUB_OWNER_SUB");
    if (!ownerEmail && !ownerSub) return { ok: false, error: "missing auth configuration" };
    if (secret.length < 16) return { ok: false, error: "missing auth configuration" };
    if (present(env, "JOEHUB_STORE") === "memory") return { ok: false, error: "missing auth configuration" };
    if (onVercel && !httpsUrl(present(env, "UPSTASH_REDIS_REST_URL"))) {
      return { ok: false, error: "missing auth configuration" };
    }
    if (!httpUrl(present(env, "UPSTASH_REDIS_REST_URL"))) return { ok: false, error: "missing auth configuration" };
    return {
      ok: true,
      mode: "oidc",
      secret,
      issuer,
      clientId: present(env, "JOEHUB_OIDC_CLIENT_ID"),
      clientSecret: present(env, "JOEHUB_OIDC_CLIENT_SECRET"),
      ownerEmail,
      ownerSub,
      keyPrefix: prefix.prefix,
    };
  }
  return { ok: true, mode: devAuthEnabled(env) ? "dev" : "dev", secret, keyPrefix: prefix.prefix };
}
