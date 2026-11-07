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

export function ownerAllowed(claims, config) {
  if (!config.ownerEmail && !config.ownerSub) return false;
  if (config.ownerSub && claims.sub !== config.ownerSub) return false;
  if (config.ownerEmail && String(claims.email || "").toLowerCase() !== config.ownerEmail) return false;
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
  const txn = {
    state: randomBytes(16).toString("hex"),
    nonce: randomBytes(16).toString("hex"),
    verifier,
    challenge,
    redirectUri,
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
  return url.toString();
}

export async function completeOidc({ code, state, config, store, redirectUri, now, fetchImpl = fetch }) {
  if (!code || !state) return { status: 401, error: "authentication required" };
  const txn = await store.takeTxn(state);
  if (!txn || txn.redirectUri !== redirectUri || now - txn.createdAt > 10 * 60 * 1000) {
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
