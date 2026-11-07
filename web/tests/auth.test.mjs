import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import test from "node:test";
import { readAuthConfig } from "../lib/auth-config.mjs";
import { clientIp, publicOrigin } from "../lib/client-ip.mjs";
import { decide } from "../lib/gate.mjs";
import { beginOidc, browserBinding, completeOidc, ownerAllowed } from "../lib/oidc.mjs";
import { seal as webSeal } from "../lib/seal.mjs";
import { createStore, login, resolveSession, revokeAll, revokeDevice, seal, SESSION_TTL_MS } from "../lib/sessions.mjs";
import { assertSafeToStart } from "../lib/startup.mjs";
import { createUpstashLimiter, createUpstashStore } from "../lib/store-upstash.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const SECRET = "test-session-secret";
const devEnv = { JOEHUB_DEV_AUTH: "1", JOEHUB_SESSION_SECRET: SECRET, NODE_ENV: "development" };

function oidcEnv(extra = {}) {
  return {
    NODE_ENV: "production",
    JOEHUB_SESSION_SECRET: SECRET,
    JOEHUB_OIDC_ISSUER: "https://issuer.example",
    JOEHUB_OIDC_CLIENT_ID: "client-test",
    JOEHUB_OIDC_CLIENT_SECRET: "client-secret-test",
    JOEHUB_OWNER_EMAIL: "owner@example.com",
    JOEHUB_OWNER_SUB: "owner-subject",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "token-test",
    ...extra,
  };
}

test("the web seal matches the server seal", async () => {
  const id = randomBytes(32).toString("hex");
  assert.equal(await webSeal(SECRET, id), seal(SECRET, id));
});

test("a session dies at fourteen days and a read does not move it", () => {
  const store = createStore();
  const now = Date.parse("2026-01-01T00:00:00Z");
  const result = login({ username: "synthetic", password: "synthetic" }, devEnv, store, now);
  const session = resolveSession(result.cookie, devEnv, store, now + SESSION_TTL_MS - 1);
  assert.ok(session);
  const again = resolveSession(result.cookie, devEnv, store, now + 13 * 24 * 60 * 60 * 1000);
  assert.equal(again.expiresAt, session.expiresAt);
  assert.equal(session.expiresAt - session.createdAt, SESSION_TTL_MS);
  assert.equal(resolveSession(result.cookie, devEnv, store, now + SESSION_TTL_MS), null);
});

test("revoke one session or every session for the owner", () => {
  const store = createStore();
  const now = 5_000;
  const first = login({ username: "synthetic", password: "synthetic" }, devEnv, store, now);
  const second = login({ username: "synthetic", password: "synthetic" }, devEnv, store, now + 1);
  assert.equal(revokeDevice(second.cookie, devEnv, store, now + 1, first.deviceId).status, 200);
  assert.equal(resolveSession(first.cookie, devEnv, store, now + 1), null);
  assert.ok(resolveSession(second.cookie, devEnv, store, now + 1));
  assert.equal(revokeAll(second.cookie, devEnv, store, now + 1).status, 200);
  assert.equal(resolveSession(first.cookie, devEnv, store, now + 2), null);
  assert.equal(resolveSession(second.cookie, devEnv, store, now + 2), null);
  const later = login({ username: "synthetic", password: "synthetic" }, devEnv, store, now + 3);
  assert.ok(resolveSession(later.cookie, devEnv, store, now + 3));
});

test("preview cannot use a production scope or the production origin", () => {
  const email = "prod-owner@example.com";
  const mismatch = readAuthConfig({
    VERCEL_ENV: "preview",
    JOEHUB_ENV_SCOPE: "production",
    JOEHUB_OWNER_EMAIL: email,
    JOEHUB_SESSION_SECRET: SECRET,
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.ownerEmail, undefined);
  assert.equal(JSON.stringify(mismatch).includes(email), false);
  assert.throws(
    () => assertSafeToStart({ VERCEL_ENV: "preview", JOEHUB_ENV_SCOPE: "production", JOEHUB_OWNER_EMAIL: email, JOEHUB_SESSION_SECRET: SECRET }),
    /env scope does not match/,
  );
  const origin = publicOrigin(new Request("https://preview.example/finance", { headers: { "x-forwarded-host": "joehub.example", "x-forwarded-proto": "https" } }), {
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_PROJECT_PRODUCTION_URL: "joehub.example",
  });
  assert.equal(origin, "");
  const local = publicOrigin(new Request("http://127.0.0.1:3488/api/auth/login", { headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" } }), {});
  assert.equal(local, "http://127.0.0.1:3488");
  assert.equal(readAuthConfig(oidcEnv({ VERCEL_ENV: "preview" })).ok, false);
  const preview = readAuthConfig(oidcEnv({ VERCEL_ENV: "preview", JOEHUB_ENV_SCOPE: "preview", JOEHUB_OWNER_EMAIL: "preview-owner@example.com" }));
  assert.equal(preview.ownerEmail, "preview-owner@example.com");
  assert.equal(readAuthConfig(oidcEnv({ VERCEL_ENV: "production", JOEHUB_ENV_SCOPE: "production" })).ok, true);
  assert.equal(readAuthConfig({ NODE_ENV: "production", JOEHUB_SESSION_SECRET: SECRET }).ok, false);
  assert.equal(readAuthConfig({ JOEHUB_OIDC_ISSUER: "https://issuer.example" }).ok, false);
  assert.equal(readAuthConfig(oidcEnv({ JOEHUB_STORE: "memory" })).ok, false);
  assert.equal(readAuthConfig(devEnv).mode, "dev");
});

test("off Vercel a forwarded client address is ignored", () => {
  const headers = { "x-forwarded-for": "1.1.1.1", "x-vercel-forwarded-for": "9.9.9.9" };
  assert.equal(clientIp(new Request("http://local/", { headers }), {}), "direct");
  const onVercel = clientIp(new Request("http://local/", { headers }), { VERCEL: "1" });
  assert.equal(onVercel, "9.9.9.9");
  assert.equal(clientIp(new Request("http://local/", { headers: { "x-forwarded-for": "8.8.8.8" } }), { VERCEL: "1" }), "unverified");
});

test("the allowlist rejects a different owner", () => {
  const config = { ownerEmail: "owner@example.com", ownerSub: "owner-subject", issuer: "https://issuer.example" };
  const owner = { iss: "https://issuer.example", sub: "owner-subject", email: "Owner@Example.com" };
  assert.equal(ownerAllowed(owner, config), true);
  assert.equal(ownerAllowed({ ...owner, sub: "other" }, config), false);
  assert.equal(ownerAllowed({ ...owner, email: "other@example.com" }, config), false);
  assert.equal(ownerAllowed({ ...owner, iss: "https://evil.example" }, config), false);
});

test("an email-only allowlist rejects an unverified address", () => {
  const emailOnly = { ownerEmail: "owner@example.com", issuer: "https://issuer.example" };
  const base = { iss: "https://issuer.example", sub: "someone", email: "owner@example.com" };
  assert.equal(ownerAllowed({ ...base, email_verified: true }, emailOnly), true);
  assert.equal(ownerAllowed({ ...base, email_verified: false }, emailOnly), false);
  assert.equal(ownerAllowed(base, emailOnly), false);
  const pinned = { ownerSub: "owner-subject", issuer: "https://issuer.example" };
  assert.equal(ownerAllowed({ iss: "https://issuer.example", sub: "owner-subject", email_verified: false }, pinned), true);
  assert.equal(ownerAllowed({ iss: "https://issuer.example", sub: "owner-subject" }, pinned), true);
  assert.equal(ownerAllowed({ iss: "https://evil.example", sub: "owner-subject", email_verified: true }, pinned), false);
});

test("oidc state is single use and the signature is checked", async () => {
  const store = createStore();
  const config = {
    issuer: "https://issuer.example",
    clientId: "client-test",
    clientSecret: "client-secret-test",
    ownerEmail: "owner@example.com",
    ownerSub: "owner-subject",
  };
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "test";
  const now = 1_700_000_000_000;
  let txn;
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/.well-known/openid-configuration")) {
      return json({
        issuer: config.issuer,
        authorization_endpoint: `${config.issuer}/authorize`,
        token_endpoint: `${config.issuer}/token`,
        jwks_uri: `${config.issuer}/jwks`,
      });
    }
    if (target.endsWith("/jwks")) return json({ keys: [{ ...jwk, kid: "test", alg: "RS256", use: "sig" }] });
    const form = new URLSearchParams(options.body);
    const challenge = createHash("sha256").update(form.get("code_verifier")).digest("base64url");
    assert.equal(challenge, txn.challenge);
    const token = sign(privateKey, { iss: config.issuer, aud: config.clientId, sub: "owner-subject", email: "owner@example.com", nonce: txn.nonce, exp: Math.floor(now / 1000) + 60 });
    return json({ id_token: token });
  };
  const started = await beginOidc(config, store, "http://127.0.0.1/api/auth/callback", now, fetchImpl);
  const state = new URL(started.url).searchParams.get("state");
  txn = await store.getTxn(state, browserBinding(started.browser));
  const stranger = await completeOidc({
    code: "abc",
    state,
    browser: "other-browser",
    config,
    store,
    redirectUri: "http://127.0.0.1/api/auth/callback",
    now,
    fetchImpl,
  });
  assert.equal(stranger.status, 401);
  assert.equal((await store.getTxn(state, browserBinding(started.browser))).nonce, txn.nonce);
  const ok = await completeOidc({
    code: "abc",
    state,
    browser: started.browser,
    config,
    store,
    redirectUri: "http://127.0.0.1/api/auth/callback",
    now,
    fetchImpl,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.claims.sub, "owner-subject");
  const again = await completeOidc({
    code: "abc",
    state,
    browser: started.browser,
    config,
    store,
    redirectUri: "http://127.0.0.1/api/auth/callback",
    now,
    fetchImpl,
  });
  assert.equal(again.status, 401);
  const signed = sign(privateKey, { iss: config.issuer, aud: config.clientId, sub: "owner-subject", email: "owner@example.com", nonce: "nope", exp: Math.floor(now / 1000) + 60 });
  const [header, payload, signature] = signed.split(".");
  const signatureBytes = Buffer.from(signature, "base64url");
  signatureBytes[0] ^= 0xff;
  const bad = `${header}.${payload}.${signatureBytes.toString("base64url")}`;
  const { verifyIdToken } = await import("../lib/oidc.mjs");
  const jwks = `${config.issuer}/jwks`;
  assert.equal(await verifyIdToken(bad, jwks, config, "nope", now, fetchImpl), null);
  const expired = sign(privateKey, { iss: config.issuer, aud: config.clientId, sub: "owner-subject", email: "owner@example.com", nonce: "n", exp: Math.floor(now / 1000) - 1 });
  assert.equal(await verifyIdToken(expired, jwks, config, "n", now, fetchImpl), null);
  const none = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from("{}").toString("base64url")}.`;
  assert.equal(await verifyIdToken(none, jwks, config, "n", now, fetchImpl), null);
  let email = "other@example.com";
  const wrongFetch = async (url, options = {}) => {
    if (String(url).endsWith("/token")) {
      const saved = txn;
      const token = sign(privateKey, { iss: config.issuer, aud: config.clientId, sub: "owner-subject", email, nonce: saved.nonce, exp: Math.floor(now / 1000) + 60 });
      return json({ id_token: token });
    }
    return fetchImpl(url, options);
  };
  const againStarted = await beginOidc(config, store, "http://127.0.0.1/api/auth/callback", now, fetchImpl);
  const againState = new URL(againStarted.url).searchParams.get("state");
  txn = await store.getTxn(againState, browserBinding(againStarted.browser));
  const forbidden = await completeOidc({
    code: "abc",
    state: againState,
    browser: againStarted.browser,
    config,
    store,
    redirectUri: "http://127.0.0.1/api/auth/callback",
    now,
    fetchImpl: wrongFetch,
  });
  assert.equal(forbidden.status, 403);
  assert.equal(store.sessions.size, 0);
});

test("parallel callbacks consume a transaction once", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "test";
  const now = 1_700_000_000_000;
  const config = {
    issuer: "https://issuer.example",
    clientId: "client-test",
    clientSecret: "client-secret-test",
    ownerEmail: "owner@example.com",
    ownerSub: "owner-subject",
  };
  const redirectUri = "http://127.0.0.1/api/auth/callback";
  async function race(store) {
    let nonce = "";
    const fetchImpl = async (url) => {
      const target = String(url);
      if (target.endsWith("/.well-known/openid-configuration")) {
        return json({
          issuer: config.issuer,
          authorization_endpoint: `${config.issuer}/authorize`,
          token_endpoint: `${config.issuer}/token`,
          jwks_uri: `${config.issuer}/jwks`,
        });
      }
      if (target.endsWith("/jwks")) return json({ keys: [{ ...jwk, kid: "test", alg: "RS256", use: "sig" }] });
      const token = sign(privateKey, {
        iss: config.issuer,
        aud: config.clientId,
        sub: "owner-subject",
        email: "owner@example.com",
        email_verified: true,
        nonce,
        exp: Math.floor(now / 1000) + 60,
      });
      return json({ id_token: token });
    };
    const started = await beginOidc(config, store, redirectUri, now, fetchImpl);
    const state = new URL(started.url).searchParams.get("state");
    const binding = browserBinding(started.browser);
    nonce = (await store.getTxn(state, binding)).nonce;
    const strangers = await Promise.all(
      [0, 1].map(() =>
        completeOidc({
          code: "abc",
          state,
          browser: "other-browser",
          config,
          store,
          redirectUri,
          now,
          fetchImpl,
        }),
      ),
    );
    assert.deepEqual(
      strangers.map((result) => result.status),
      [401, 401],
    );
    assert.equal((await store.getTxn(state, binding)).nonce, nonce);
    const results = await Promise.all(
      [0, 1, 2, 3].map(() =>
        completeOidc({
          code: "abc",
          state,
          browser: started.browser,
          config,
          store,
          redirectUri,
          now,
          fetchImpl,
        }),
      ),
    );
    assert.equal(results.filter((result) => result.status === 200).length, 1);
    assert.equal(results.filter((result) => result.status === 401).length, 3);
    assert.equal(await store.getTxn(state, binding), null);
  }
  await race(createStore());
  const fake = await startFakeUpstash();
  try {
    await race(createUpstashStore({ url: fake.url, token: fake.token }));
  } finally {
    fake.stop();
  }
});

function json(body, status = 200) {
  return { ok: status === 200, status, json: async () => body };
}

function sign(privateKey, payload) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  const sig = createSign("RSA-SHA256").update(data).sign(privateKey).toString("base64url");
  return `${data}.${sig}`;
}

test("the upstash adapter uses the REST server and fails closed", async () => {
  const fake = await startFakeUpstash();
  try {
    const store = createUpstashStore({ url: fake.url, token: fake.token });
    const now = Date.now();
    const session = {
      id: "a".repeat(64),
      deviceId: "device-1",
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      revoked: false,
      owner: "owner-subject",
      label: "browser",
    };
    await store.putSession(session, now);
    const setsAfterWrite = fake.counts.set;
    const read = await store.getSession(session.id, now + 1000);
    assert.equal(read.expiresAt, session.expiresAt);
    assert.equal(fake.counts.set, setsAfterWrite);
    assert.equal(await store.getSession(session.id, now + SESSION_TTL_MS), null);
    await store.revokeAll(session.owner, now + 5);
    const fresh = { ...session, id: "b".repeat(64), deviceId: "device-2", createdAt: now + 6 };
    await store.putSession(fresh, now + 6);
    assert.equal(await store.getSession(session.id, now + 7), null);
    assert.ok(await store.getSession(fresh.id, now + 7));
    assert.equal(await store.hit("login", "direct", 2, 60_000, now), true);
    assert.equal(await store.hit("login", "direct", 2, 60_000, now), true);
    assert.equal(await store.hit("login", "direct", 2, 60_000, now), false);
    const loginLimit = createUpstashLimiter(store, "login", 5, 60_000);
    for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(await loginLimit.allow("owner", now), true);
    assert.equal(await loginLimit.allow("owner", now), false);
    fake.setFail(true);
    await assert.rejects(() => store.getSession(fresh.id, now + 7));
  } finally {
    fake.stop();
  }
});

test("production middleware fails closed without opening a page", async () => {
  const env = oidcEnv();
  const page = await decide(new Request("http://127.0.0.1/finance"), env, Date.now());
  assert.equal(page.type, "redirect");
  assert.equal(page.location, "/api/auth/login");
  const api = await decide(new Request("http://127.0.0.1/api/finance/accounts"), env, Date.now());
  assert.equal(api.status, 401);
  const health = await decide(new Request("http://127.0.0.1/api/health"), { VERCEL_ENV: "preview", JOEHUB_ENV_SCOPE: "production" }, Date.now());
  assert.equal(health.type, "next");
  const closed = await decide(new Request("http://127.0.0.1/finance"), { VERCEL_ENV: "preview", JOEHUB_ENV_SCOPE: "production", JOEHUB_OWNER_EMAIL: "secret-owner@example.com" }, Date.now());
  assert.equal(closed.status, 503);
  assert.equal(JSON.stringify(closed).includes("secret-owner@example.com"), false);
});
