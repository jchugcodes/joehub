import { createHash, createPublicKey, createVerify, randomBytes } from "node:crypto";
import { StoreError } from "./store-upstash.mjs";

const discoveryCache = new Map();

function base64urlJson(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

export function createPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function browserBinding(browser) {
  if (!browser) return "";
  return createHash("sha256").update(String(browser)).digest("base64url");
}

async function discover(issuer, fetchImpl) {
  const cacheable = fetchImpl === fetch;
  if (cacheable && discoveryCache.has(issuer)) return discoveryCache.get(issuer);
  let response;
  try {
    response = await fetchImpl(`${issuer}/.well-known/openid-configuration`);
  } catch {
    throw new StoreError();
  }
  if (!response.ok) throw new StoreError();
  const doc = await response.json();
  if (!doc || doc.issuer !== issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new StoreError();
  }
  if (cacheable) discoveryCache.set(issuer, doc);
  return doc;
}

export const OIDC_COOKIE = "joehub_oidc";
export const OIDC_TTL_MS = 10 * 60 * 1000;

export function readOidcCookie(header) {
  const raw = String(header || "");
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === OIDC_COOKIE) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return "";
}

export function ownerAllowed(claims, config) {
  if (!config.ownerEmail && !config.ownerSub) return false;
  if (config.issuer && claims.iss !== config.issuer) return false;
  const subPinned = Boolean(config.ownerSub);
  if (subPinned && claims.sub !== config.ownerSub) return false;
  if (config.ownerEmail) {
    if (String(claims.email || "").toLowerCase() !== config.ownerEmail) return false;
    // An email-only allowlist can be spoofed until the provider says the
    // address is verified. A pinned issuer and subject does not need that claim.
    if (!subPinned && claims.email_verified !== true) return false;
  }
  return true;
}

export async function verifyIdToken(idToken, jwksUri, config, nonce, now, fetchImpl) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) return null;
  let header;
  let claims;
  try {
    header = base64urlJson(parts[0]);
    claims = base64urlJson(parts[1]);
  } catch {
    return null;
  }
  if (!header || header.alg !== "RS256" || !header.kid) return null;
  let response;
  try {
    response = await fetchImpl(jwksUri);
  } catch {
    throw new StoreError();
  }
  if (!response.ok) throw new StoreError();
  const jwks = await response.json();
  const jwk = (jwks.keys || []).find((key) => key.kid === header.kid);
  if (!jwk) return null;
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const ok = createVerify("RSA-SHA256").update(`${parts[0]}.${parts[1]}`).verify(key, Buffer.from(parts[2], "base64url"));
  if (!ok) return null;
  const audOk = claims.aud === config.clientId || (Array.isArray(claims.aud) && claims.aud.includes(config.clientId));
  if (claims.iss !== config.issuer || !audOk) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
  if (claims.nonce !== nonce) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  return claims;
}

export async function beginOidc(config, store, redirectUri, now, fetchImpl = fetch) {
  const discovery = await discover(config.issuer, fetchImpl);
  const { verifier, challenge } = createPkce();
  const browser = randomBytes(32).toString("base64url");
  const binding = browserBinding(browser);
  const txn = {
    state: randomBytes(16).toString("hex"),
    nonce: randomBytes(16).toString("hex"),
    verifier,
    challenge,
    redirectUri,
    browser,
    binding,
    createdAt: now,
  };
  await store.putTxn(txn, now);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", txn.state);
  url.searchParams.set("nonce", txn.nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), browser };
}

function txnFresh(txn, redirectUri, browser, now) {
  return Boolean(
    txn &&
      txn.browser &&
      txn.browser === browser &&
      txn.redirectUri === redirectUri &&
      now - txn.createdAt <= 10 * 60 * 1000,
  );
}

export async function completeOidc({ code, state, browser, config, store, redirectUri, now, fetchImpl = fetch }) {
  if (!code || !state || !browser) return { status: 401, error: "authentication required" };
  const binding = browserBinding(browser);
  const pending = await store.getTxn(state, binding);
  if (!txnFresh(pending, redirectUri, browser, now)) {
    return { status: 401, error: "authentication required" };
  }
  const txn = await store.takeTxn(state, binding);
  if (!txnFresh(txn, redirectUri, browser, now)) {
    return { status: 401, error: "authentication required" };
  }
  const discovery = await discover(config.issuer, fetchImpl);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: String(code),
    redirect_uri: redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: txn.verifier,
  });
  let tokenResponse;
  try {
    tokenResponse = await fetchImpl(discovery.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new StoreError();
  }
  if (!tokenResponse.ok) return { status: 401, error: "authentication required" };
  const token = await tokenResponse.json();
  const claims = await verifyIdToken(token && token.id_token, discovery.jwks_uri, config, txn.nonce, now, fetchImpl);
  if (!claims) return { status: 401, error: "authentication required" };
  if (!ownerAllowed(claims, config)) return { status: 403, error: "not the owner" };
  return { status: 200, claims, txn };
}
