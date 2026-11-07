import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { startFakeOidc, startFakeUpstash } from "./support/fakes.mjs";
import { reservePort, stopProcess } from "./support/harness.mjs";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SECRET = "auth-http-secret-value";
const PAGES = [
  "/",
  "/finance",
  "/finance/accounts",
  "/finance/caps",
  "/finance/dining-out",
  "/finance/goals",
  "/finance/goals/student-loan-payoff",
  "/jobs",
  "/jobs/globex",
  "/jobs/globex/stage",
  "/journal",
  "/journal/compose",
  "/journal/nightly-win-nov-6",
  "/more",
  "/more/database",
];
const APIS = [
  ["/api/finance/accounts", "GET"],
  ["/api/finance/transactions", "GET"],
  ["/api/jobs/applications", "GET"],
  ["/api/jobs/statuses", "GET"],
  ["/api/journal/entries", "GET"],
  ["/api/journal/events", "GET"],
  ["/api/session/devices", "GET"],
  ["/api/session/logout", "POST"],
  ["/api/session/devices/unknown/revoke", "POST"],
  ["/api/session/revoke-all", "POST"],
];

function cleanEnv(extra) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME || "/tmp",
    TMPDIR: process.env.TMPDIR || "/tmp",
    LANG: "C.UTF-8",
    ...extra,
  };
}

function cookieRows(response) {
  return typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
}

function cookiePair(response, name) {
  const row = cookieRows(response).find((item) => item.startsWith(`${name}=`));
  return row ? row.split(";", 1)[0] : "";
}

test.before(() => {
  const build = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
    cwd: ROOT,
    env: cleanEnv({ NODE_ENV: "production" }),
    encoding: "utf8",
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
});

async function enforceAuth(mode, port) {
  const base = `http://127.0.0.1:${port}`;
  const upstash = await startFakeUpstash();
  const oidc = await startFakeOidc({
    clientId: "client-test",
    clientSecret: "client-secret-test",
    sub: "owner-subject",
    email: "owner@example.com",
  });
  let output = "";
  const child = mode === "standalone"
    ? spawn(process.execPath, ["server.js"], {
        cwd: `${ROOT}/.next/standalone`,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: cleanEnv({
          NODE_ENV: "production",
          HOSTNAME: "127.0.0.1",
          PORT: String(port),
          JOEHUB_SESSION_SECRET: SECRET,
          JOEHUB_OIDC_ISSUER: oidc.issuer,
          JOEHUB_OIDC_CLIENT_ID: "client-test",
          JOEHUB_OIDC_CLIENT_SECRET: "client-secret-test",
          JOEHUB_OWNER_EMAIL: "owner@example.com",
          JOEHUB_OWNER_SUB: "owner-subject",
          UPSTASH_REDIS_REST_URL: upstash.url,
          UPSTASH_REDIS_REST_TOKEN: upstash.token,
          JOEHUB_PUBLIC_ORIGIN: base,
          VERCEL: "1",
        }),
      })
    : spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: ROOT,
    env: cleanEnv({
      NODE_ENV: "production",
      JOEHUB_SESSION_SECRET: SECRET,
      JOEHUB_OIDC_ISSUER: oidc.issuer,
      JOEHUB_OIDC_CLIENT_ID: "client-test",
      JOEHUB_OIDC_CLIENT_SECRET: "client-secret-test",
      JOEHUB_OWNER_EMAIL: "owner@example.com",
      JOEHUB_OWNER_SUB: "owner-subject",
      UPSTASH_REDIS_REST_URL: upstash.url,
      UPSTASH_REDIS_REST_TOKEN: upstash.token,
      JOEHUB_PUBLIC_ORIGIN: base,
      VERCEL: "1",
    }),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const log = () => output.slice(-2000);
  try {
    const deadline = Date.now() + 30000;
    let health;
    while (Date.now() < deadline) {
      if (child.exitCode != null) throw new Error(`next start exited\n${log()}`);
      try {
        health = await fetch(`${base}/api/health`);
        if (health.status === 200) break;
      } catch {
        // booting
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(health && health.status, 200, log());
    assert.deepEqual(await health.json(), { ok: true });

    for (const path of PAGES) {
      const response = await fetch(`${base}${path}`, { redirect: "manual" });
      assert.equal(response.status, 307, path);
      assert.equal(new URL(response.headers.get("location")).pathname, "/api/auth/login");
      assert.equal((await response.text()).includes("Sample Checking"), false);
    }
    for (const [path, method] of APIS) {
      const response = await fetch(`${base}${path}`, { method, redirect: "manual" });
      assert.equal(response.status, 401, path);
      assert.equal(JSON.stringify(await response.json()).includes("SYNTHETIC-ACORN-PAYEE"), false);
    }
    const devLogin = await fetch(`${base}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "synthetic", password: "synthetic" }),
    });
    assert.equal(devLogin.status, 404);

    const started = await fetch(`${base}/api/auth/login`, { redirect: "manual" });
    assert.equal(started.status, 307);
    const txnCookie = cookiePair(started, "joehub_oidc");
    const txnSet = cookieRows(started).find((item) => item.startsWith("joehub_oidc=")) || "";
    assert.match(txnSet, /httponly/i);
    assert.match(txnSet, /secure/i);
    assert.match(txnSet, /samesite=lax/i);
    const authorize = new URL(started.headers.get("location"));
    assert.equal(authorize.origin, oidc.issuer);
    assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
    const back = await fetch(authorize, { redirect: "manual" });
    const callback = new URL(back.headers.get("location"));
    const stranger = await fetch(callback, { redirect: "manual" });
    assert.equal(stranger.status, 401);
    const done = await fetch(callback, { redirect: "manual", headers: { cookie: txnCookie } });
    const setCookie = cookiePair(done, "joehub_session");
    const sessionSet = cookieRows(done).find((item) => item.startsWith("joehub_session=")) || "";
    assert.match(sessionSet, /httponly/i);
    assert.match(sessionSet, /secure/i);
    assert.match(sessionSet, /samesite=lax/i);
    const replay = await fetch(callback, { redirect: "manual", headers: { cookie: txnCookie } });
    assert.equal(replay.status, 401);
    const cookie = setCookie;
    const sessionId = cookie.split("=")[1].split(".")[0];
    const auth = { cookie };
    const home = await fetch(`${base}/`, { headers: auth, redirect: "manual" });
    assert.equal(home.status, 200);
    assert.equal(home.headers.get("set-cookie"), null);
    const before = await fetch(upstash.url, {
      method: "POST",
      headers: { authorization: `Bearer ${upstash.token}`, "content-type": "application/json" },
      body: JSON.stringify(["GET", `joehub:sess:${sessionId}`]),
    }).then((response) => response.json());
    const accounts = await fetch(`${base}/api/finance/accounts`, { headers: auth });
    assert.equal(accounts.status, 200);
    const after = await fetch(upstash.url, {
      method: "POST",
      headers: { authorization: `Bearer ${upstash.token}`, "content-type": "application/json" },
      body: JSON.stringify(["GET", `joehub:sess:${sessionId}`]),
    }).then((response) => response.json());
    assert.equal(after.result, before.result);

    const stored = JSON.parse(before.result);
    assert.equal(stored.expiresAt - stored.createdAt, 14 * 24 * 60 * 60 * 1000);
    stored.expiresAt = Date.now() - 1;
    await fetch(upstash.url, {
      method: "POST",
      headers: { authorization: `Bearer ${upstash.token}`, "content-type": "application/json" },
      body: JSON.stringify(["SET", `joehub:sess:${sessionId}`, JSON.stringify(stored), "EX", "60"]),
    });
    assert.equal((await fetch(`${base}/api/finance/accounts`, { headers: auth })).status, 401);
    stored.expiresAt = stored.createdAt + 14 * 24 * 60 * 60 * 1000;
    await fetch(upstash.url, {
      method: "POST",
      headers: { authorization: `Bearer ${upstash.token}`, "content-type": "application/json" },
      body: JSON.stringify(["SET", `joehub:sess:${sessionId}`, JSON.stringify(stored), "EX", "1209600"]),
    });
    assert.equal((await fetch(`${base}/api/finance/accounts`, { headers: auth })).status, 200);

    upstash.setFail(true);
    assert.equal((await fetch(`${base}/api/finance/accounts`, { headers: auth })).status, 503);
    const brokenPage = await fetch(`${base}/finance`, { headers: auth, redirect: "manual" });
    assert.equal(brokenPage.status, 503);
    assert.equal((await brokenPage.text()).includes("Sample Checking"), false);
    upstash.setFail(false);
    assert.equal((await fetch(`${base}/api/finance/accounts`, { headers: auth })).status, 200);

    const second = await signIn(oidc);
    const revoked = await fetch(`${base}/api/session/devices/${stored.deviceId}/revoke`, { method: "POST", headers: { cookie: second.cookie } });
    assert.equal(revoked.status, 200);
    assert.equal((await fetch(`${base}/api/journal/entries`, { headers: auth })).status, 401);
    assert.equal((await fetch(`${base}/api/finance/accounts`, { headers: { cookie: second.cookie } })).status, 200);

    const third = await signIn(oidc);
    const all = await fetch(`${base}/api/session/revoke-all`, { method: "POST", headers: { cookie: third.cookie } });
    assert.equal(all.status, 200);
    assert.equal((await fetch(`${base}/api/finance/accounts`, { headers: { cookie: second.cookie } })).status, 401);
    assert.equal((await fetch(`${base}/api/finance/accounts`, { headers: { cookie: third.cookie } })).status, 401);

    const current = await signIn(oidc);
    const loggedOut = await fetch(`${base}/api/session/logout`, { method: "POST", headers: { cookie: current.cookie } });
    assert.equal(loggedOut.status, 200);
    assert.match(loggedOut.headers.get("set-cookie") || "", /joehub_session=/);
    assert.equal((await fetch(`${base}/api/finance/accounts`, { headers: { cookie: current.cookie } })).status, 401);

    let limited = false;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch(`${base}/api/auth/login`, { redirect: "manual" });
      if (response.status === 429) {
        limited = true;
        break;
      }
      assert.equal(response.status, 307);
    }
    assert.equal(limited, true);
    for (const ip of ["203.0.113.10", "203.0.113.11"]) {
      const separate = await fetch(`${base}/api/auth/login`, {
        redirect: "manual",
        headers: { "x-vercel-forwarded-for": ip },
      });
      assert.equal(separate.status, 307, ip);
    }
  } finally {
    await stopProcess(child);
    upstash.stop();
    oidc.stop();
  }

  async function signIn(issuer) {
    const started = await fetch(`${base}/api/auth/login`, { redirect: "manual" });
    if (started.status === 429 || started.status === 503) throw new Error(`login ${started.status}`);
    const txnCookie = cookiePair(started, "joehub_oidc");
    const authorize = new URL(started.headers.get("location"));
    assert.equal(authorize.origin, issuer.issuer);
    const back = await fetch(authorize, { redirect: "manual" });
    const done = await fetch(back.headers.get("location"), { redirect: "manual", headers: { cookie: txnCookie } });
    if (done.status !== 307) throw new Error(`callback ${done.status}`);
    return { cookie: cookiePair(done, "joehub_session") };
  }
}

test("production next start enforces auth", { timeout: 180000 }, async () => enforceAuth("start", await reservePort()));

test("standalone server enforces auth", { timeout: 180000 }, async () => enforceAuth("standalone", await reservePort()));

test("a preview process refuses a production scope", { timeout: 60000 }, async () => {
  const port = await reservePort();
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: ROOT,
    env: cleanEnv({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      JOEHUB_ENV_SCOPE: "production",
      JOEHUB_OWNER_EMAIL: "prod-owner@example.com",
      JOEHUB_SESSION_SECRET: SECRET,
    }),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  try {
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
        resolve("still-running");
      }, 20000);
      child.on("exit", (status) => {
        clearTimeout(timer);
        resolve(status);
      });
    });
    assert.notEqual(code, "still-running");
    assert.notEqual(code, 0);
    assert.match(output, /env scope does not match/);
    assert.equal(output.includes("prod-owner@example.com"), false);
  } finally {
    await stopProcess(child);
  }
});
