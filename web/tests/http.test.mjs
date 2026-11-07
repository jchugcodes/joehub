import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { reservePort, spawnLogged, stopProcess, waitForHttp } from "./support/harness.mjs";

let port = 0;
const base = () => `http://127.0.0.1:${port}`;
const SECRET = "http-test-secret-value";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = JSON.parse(readFileSync(new URL("../lib/fixtures.json", import.meta.url), "utf8"));

const CONTRACT = {
  "/api/finance/accounts": "accounts",
  "/api/finance/transactions": "transactions",
  "/api/jobs/applications": "applications",
  "/api/jobs/statuses": "statuses",
  "/api/journal/entries": "entries",
  "/api/journal/events": "events",
};

function cookieValue(response) {
  const rows = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const raw = rows.find((row) => row.startsWith("joehub_session=")) || response.headers.get("set-cookie") || "";
  assert.match(raw, /httponly/i);
  assert.match(raw, /secure/i);
  assert.match(raw, /samesite=lax/i);
  return raw.split(";", 1)[0].slice("joehub_session=".length);
}

test("next http login, session, logout, revoke, and contract json", { timeout: 120000 }, async () => {
  port = await reservePort();
  const started = spawnLogged(["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME || "/tmp",
      TMPDIR: process.env.TMPDIR || "/tmp",
      LANG: "C.UTF-8",
      NODE_ENV: "development",
      JOEHUB_DEV_AUTH: "1",
      JOEHUB_SESSION_SECRET: SECRET,
    },
  });
  const child = started.child;
  try {
    await waitForHttp(`${base()}/api/finance/accounts`, {
      child,
      log: started.log,
      accept: (response) => response.status === 401 && (response.headers.get("content-type") || "").includes("application/json"),
    });
    const denied = await fetch(`${base()}/api/finance/accounts`);
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("content-type") || "", /application\/json/);

    const page = await fetch(`${base()}/finance/accounts`);
    assert.equal((page.headers.get("content-type") || "").includes("application/json"), false);

    const logged = await fetch(`${base()}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "http-test" }),
    });
    assert.equal(logged.status, 200);
    assert.match(logged.headers.get("content-type") || "", /application\/json/);
    const first = cookieValue(logged);
    const auth = { cookie: `joehub_session=${first}` };

    const devices = await fetch(`${base()}/api/session/devices`, { headers: auth });
    assert.equal(devices.status, 200);
    assert.match(devices.headers.get("content-type") || "", /application\/json/);
    const listed = await devices.json();
    assert.equal(listed[0].label, "http-test");
    assert.equal(listed[0].session_id, undefined);

    for (const [path, key] of Object.entries(CONTRACT)) {
      const response = await fetch(`${base()}${path}`, { headers: auth });
      assert.equal(response.status, 200, `${path} ${await response.clone().text()}`);
      assert.match(response.headers.get("content-type") || "", /application\/json/, path);
      assert.deepEqual(await response.json(), FIXTURES[key]);
    }

    const secondLogin = await fetch(`${base()}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "second" }),
    });
    assert.equal(secondLogin.status, 200);
    const second = cookieValue(secondLogin);
    const again = await fetch(`${base()}/api/session/devices`, { headers: { cookie: `joehub_session=${second}` } });
    const rows = await again.json();
    const original = rows.find((row) => row.label === "http-test");
    const revoked = await fetch(`${base()}/api/session/devices/${original.id}/revoke`, {
      method: "POST",
      headers: { cookie: `joehub_session=${second}` },
    });
    assert.equal(revoked.status, 200);
    assert.match(revoked.headers.get("content-type") || "", /application\/json/);
    const afterRevoke = await fetch(`${base()}/api/finance/accounts`, { headers: auth });
    assert.equal(afterRevoke.status, 401);

    const loggedOut = await fetch(`${base()}/api/session/logout`, {
      method: "POST",
      headers: { cookie: `joehub_session=${second}` },
    });
    assert.equal(loggedOut.status, 200);
    const cleared = (loggedOut.headers.get("set-cookie") || "").toLowerCase();
    assert.match(cleared, /joehub_session=/);
    const afterLogout = await fetch(`${base()}/api/journal/entries`, {
      headers: { cookie: `joehub_session=${second}` },
    });
    assert.equal(afterLogout.status, 401);

    const unicode = await fetch(`${base()}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "synthétic", password: "synthetic" }),
    });
    assert.equal(unicode.status, 401);
    const malformed = await fetch(`${base()}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    const typed = await fetch(`${base()}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: ["synthetic"], password: "synthetic" }),
    });
    assert.equal(typed.status, 400);

    for (const hop of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      const response = await fetch(`${base()}/api/session/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": hop },
        body: JSON.stringify({ username: "nope", password: "nope" }),
      });
      assert.notEqual(response.status, 500);
      if (hop === "3.3.3.3") assert.equal(response.status, 429);
      else assert.equal(response.status, 401);
    }
  } finally {
    await stopProcess(child);
  }
});
