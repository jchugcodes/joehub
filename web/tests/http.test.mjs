import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const PORT = 3391;
const BASE = `http://127.0.0.1:${PORT}`;
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

async function waitForApi(child, log) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`next dev exited\n${log()}`);
    try {
      const response = await fetch(`${BASE}/api/finance/accounts`);
      const type = response.headers.get("content-type") || "";
      if (response.status === 401 && type.includes("application/json")) return;
    } catch {
      // The dev server is still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`next dev did not serve JSON\n${log()}`);
}

test("next http login, session, logout, revoke, and contract json", { timeout: 120000 }, async () => {
  let output = "";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(PORT)], {
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
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const log = () => output.slice(-4000);
  try {
    await waitForApi(child, log);
    const denied = await fetch(`${BASE}/api/finance/accounts`);
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("content-type") || "", /application\/json/);

    const page = await fetch(`${BASE}/finance/accounts`);
    assert.equal((page.headers.get("content-type") || "").includes("application/json"), false);

    const logged = await fetch(`${BASE}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "http-test" }),
    });
    assert.equal(logged.status, 200);
    assert.match(logged.headers.get("content-type") || "", /application\/json/);
    const first = cookieValue(logged);
    const auth = { cookie: `joehub_session=${first}` };

    const devices = await fetch(`${BASE}/api/session/devices`, { headers: auth });
    assert.equal(devices.status, 200);
    assert.match(devices.headers.get("content-type") || "", /application\/json/);
    const listed = await devices.json();
    assert.equal(listed[0].label, "http-test");
    assert.equal(listed[0].session_id, undefined);

    for (const [path, key] of Object.entries(CONTRACT)) {
      const response = await fetch(`${BASE}${path}`, { headers: auth });
      assert.equal(response.status, 200, `${path} ${await response.clone().text()}`);
      assert.match(response.headers.get("content-type") || "", /application\/json/, path);
      assert.deepEqual(await response.json(), FIXTURES[key]);
    }

    const secondLogin = await fetch(`${BASE}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "second" }),
    });
    assert.equal(secondLogin.status, 200);
    const second = cookieValue(secondLogin);
    const again = await fetch(`${BASE}/api/session/devices`, { headers: { cookie: `joehub_session=${second}` } });
    const rows = await again.json();
    const original = rows.find((row) => row.label === "http-test");
    const revoked = await fetch(`${BASE}/api/session/devices/${original.id}/revoke`, {
      method: "POST",
      headers: { cookie: `joehub_session=${second}` },
    });
    assert.equal(revoked.status, 200);
    assert.match(revoked.headers.get("content-type") || "", /application\/json/);
    const afterRevoke = await fetch(`${BASE}/api/finance/accounts`, { headers: auth });
    assert.equal(afterRevoke.status, 401);

    const loggedOut = await fetch(`${BASE}/api/session/logout`, {
      method: "POST",
      headers: { cookie: `joehub_session=${second}` },
    });
    assert.equal(loggedOut.status, 200);
    const cleared = (loggedOut.headers.get("set-cookie") || "").toLowerCase();
    assert.match(cleared, /joehub_session=/);
    const afterLogout = await fetch(`${BASE}/api/journal/entries`, {
      headers: { cookie: `joehub_session=${second}` },
    });
    assert.equal(afterLogout.status, 401);

    const unicode = await fetch(`${BASE}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "synthétic", password: "synthetic" }),
    });
    assert.equal(unicode.status, 401);
    const malformed = await fetch(`${BASE}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    const typed = await fetch(`${BASE}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: ["synthetic"], password: "synthetic" }),
    });
    assert.equal(typed.status, 400);

    for (const hop of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      const response = await fetch(`${BASE}/api/session/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": hop },
        body: JSON.stringify({ username: "nope", password: "nope" }),
      });
      assert.notEqual(response.status, 500);
      if (hop === "3.3.3.3") assert.equal(response.status, 429);
      else assert.equal(response.status, 401);
    }
  } finally {
    child.kill("SIGTERM");
  }
});
