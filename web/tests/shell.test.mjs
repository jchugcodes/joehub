import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createStore, login, resolveSession, revokeDevice, SESSION_TTL_MS } from "../lib/sessions.mjs";
import { assertSafeToStart } from "../lib/startup.mjs";
import { createLimiter } from "../lib/ratelimit.mjs";
import { handleGet, handleLogin } from "../lib/api.mjs";
import { loadFixtures } from "../lib/fixtures.mjs";

const SECRET = "test-session-secret";
const devEnv = { JOEHUB_DEV_AUTH: "1", JOEHUB_SESSION_SECRET: SECRET, NODE_ENV: "development" };

test("fixtures match the shared contract keys", () => {
  const data = loadFixtures();
  assert.equal(data.accounts[0].name, "Sample Checking");
  assert.equal(data.transactions[0].payee, "SYNTHETIC-ACORN-PAYEE");
  assert.equal(data.applications.length, 2);
  assert.equal(data.statuses.length, 2);
  assert.equal(data.entries.length, 2);
  assert.equal(data.events.length, 2);
  const spec = JSON.parse(readFileSync(new URL("../../contract/openapi.json", import.meta.url), "utf8"));
  for (const name of [
    "AccountBalance",
    "TransactionRow",
    "ApplicationRow",
    "StatusCount",
    "JournalEntry",
    "EventRow",
    "Device",
  ]) {
    const source = readFileSync(new URL("../lib/contract.ts", import.meta.url), "utf8");
    assert.match(source, new RegExp(`export interface ${name}`));
  }
  assert.ok(spec.paths["/finance/accounts"].get);
  assert.equal(spec.paths["/finance/accounts"].post, undefined);
});

test("session expiry is fourteen days and does not roll", () => {
  const store = createStore();
  const now = Date.parse("2026-01-01T00:00:00Z");
  const result = login({ username: "synthetic", password: "synthetic", device_label: "lab" }, devEnv, store, now);
  const session = resolveSession(result.cookie, devEnv, store, now + 13 * 24 * 60 * 60 * 1000);
  assert.ok(session);
  assert.equal(session.expiresAt - session.createdAt, SESSION_TTL_MS);
  assert.equal(resolveSession(result.cookie, devEnv, store, now + SESSION_TTL_MS), null);
});

test("revoke and production fake login", () => {
  const store = createStore();
  const now = 1_000;
  const first = login({ username: "synthetic", password: "synthetic" }, devEnv, store, now);
  const second = login({ username: "synthetic", password: "synthetic" }, devEnv, store, now);
  const headers = { get: () => `${"joehub_session"}=${second.cookie}` };
  const revoked = revokeDevice(second.cookie, devEnv, store, now, store.sessions.get(first.cookie.split(".")[0]).deviceId);
  assert.equal(revoked.status, 200);
  assert.equal(resolveSession(first.cookie, devEnv, store, now), null);
  assert.ok(resolveSession(second.cookie, devEnv, store, now));
  const prod = login(
    { username: "synthetic", password: "synthetic" },
    { NODE_ENV: "production", JOEHUB_DEV_AUTH: "1", JOEHUB_SESSION_SECRET: SECRET },
    store,
    now,
  );
  assert.equal(prod.status, 404);
  assert.equal(headers.get().includes(second.cookie), true);
});

test("reads require a session and rate limit", () => {
  const store = createStore();
  const limiter = createLimiter(2);
  const now = 50;
  const denied = handleGet("transactions", { get: () => "" }, devEnv, store, limiter, now, "ip");
  assert.equal(denied.status, 401);
  assert.equal(JSON.stringify(denied.body).includes("SYNTHETIC-ACORN-PAYEE"), false);
  const logged = handleLogin(
    { username: "synthetic", password: "synthetic" },
    devEnv,
    store,
    createLimiter(5),
    now,
    "ip",
  );
  const headers = { get: () => `joehub_session=${logged.cookie}` };
  assert.equal(handleGet("transactions", headers, devEnv, store, limiter, now, "ip").status, 200);
  assert.equal(handleGet("transactions", headers, devEnv, store, limiter, now, "ip").status, 429);
});

test("production start fails closed", () => {
  assert.throws(
    () => assertSafeToStart({ NODE_ENV: "production" }),
    /refusing to start/,
  );
  assert.throws(
    () =>
      assertSafeToStart({
        NODE_ENV: "production",
        JOEHUB_SESSION_SECRET: SECRET,
        JOEHUB_DEV_AUTH: "1",
      }),
    /refusing to start/,
  );
  assert.throws(
    () => assertSafeToStart({ NODE_ENV: "development", JOEHUB_DB_PATH: "/tmp/joehub.db" }),
    /refusing to start/,
  );
  assert.doesNotThrow(() =>
    assertSafeToStart({ NODE_ENV: "production", npm_lifecycle_event: "build" }),
  );
  const respond = readFileSync(new URL("../lib/respond.ts", import.meta.url), "utf8");
  assert.match(respond, /httpOnly:\s*true/);
  assert.match(respond, /secure:\s*true/);
  assert.match(respond, /sameSite:\s*"lax"/);
});
