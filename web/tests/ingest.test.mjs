import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createClient } from "@libsql/client";
import { decide } from "../lib/gate.mjs";
import {
  INGEST_ENTITIES,
  INGEST_RATE_LIMIT,
  handleIngest,
  hashesEqual,
  tokenDigest,
  withIngestHeaders,
} from "../lib/ingest.mjs";
import { assertIngestUrl, mintIngestToken } from "../scripts/ingest-token.mjs";
import { migrateLibsql } from "../scripts/libsql-migrate.mjs";

const NOW = Date.parse("2026-11-19T05:46:10.000Z");
const TITLE = "Pack the sample";
const SECRET = "do-not-echo-this-value";

function envSqlite() {
  return { JOEHUB_BACKEND_TASKS: "sqlite", VERCEL_ENV: "production" };
}

async function setup() {
  const client = createClient({ url: ":memory:" });
  await migrateLibsql({ client, url: ":memory:", test: true });
  const cato = await mintIngestToken(client, "cato", new Date(NOW));
  const scout = await mintIngestToken(client, "scout", new Date(NOW));
  const ledger = await mintIngestToken(client, "ledger", new Date(NOW));
  return { client, cato, scout, ledger };
}

async function post(ctx, { token, entity = "tasks", body, key = "sample-key", cookie, limit, raw, env, now = NOW } = {}) {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (cookie) headers.set("cookie", cookie);
  if (key !== null) headers.set("idempotency-key", key);
  const rawBody = raw ?? JSON.stringify(body ?? { title: TITLE });
  return handleIngest({
    entity,
    rawBody,
    headers,
    env: env || envSqlite(),
    now,
    client: ctx.client,
    limit,
  });
}

function runNode(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, JOEHUB_LIBSQL_URL: "", JOEHUB_LIBSQL_AUTH_TOKEN: "", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("bearer tokens are hashed and compared in constant time", () => {
  const digest = tokenDigest("jht_example");
  assert.equal(digest.length, 64);
  assert.equal(hashesEqual(digest, digest), true);
  assert.equal(hashesEqual(digest, "0".repeat(64)), false);
  assert.equal(INGEST_RATE_LIMIT, 60);
  assert.deepEqual(Object.keys(INGEST_ENTITIES), ["tasks"]);
  assert.deepEqual(INGEST_ENTITIES.tasks.owners, ["Cato"]);
});

test("ingest refuses a missing token, a bad token, and a session cookie alone", async () => {
  const ctx = await setup();
  try {
    const missing = await post(ctx, { token: undefined });
    assert.equal(missing.status, 401);
    assert.deepEqual(missing.body, { detail: "authentication required" });

    const bad = await post(ctx, { token: "jht_not-a-real-token" });
    assert.equal(bad.status, 401);
    assert.equal(JSON.stringify(bad.body).includes("jht_not-a-real-token"), false);

    const hashed = await post(ctx, { token: tokenDigest(ctx.cato) });
    assert.equal(hashed.status, 401);

    const cookie = await post(ctx, {
      token: undefined,
      cookie: "joehub_session=session-cookie-value",
    });
    assert.equal(cookie.status, 401);
    assert.equal(JSON.stringify(cookie.body).includes("session-cookie-value"), false);

    const tasks = await ctx.client.execute("SELECT COUNT(*) AS n FROM tasks");
    assert.equal(Number(tasks.rows[0].n), 0);
  } finally {
    ctx.client.close();
  }
});

test("the mint script stores the hash and not the plaintext", async () => {
  const ctx = await setup();
  try {
    const rotated = await mintIngestToken(ctx.client, "Cato", new Date(NOW));
    assert.notEqual(rotated, ctx.cato);
    const rows = await ctx.client.execute("SELECT * FROM principals");
    const dumped = JSON.stringify(rows.rows);
    assert.equal(dumped.includes(ctx.cato), false);
    assert.equal(dumped.includes(rotated), false);
    const cato = rows.rows.find((row) => row.name === "Cato");
    assert.equal(String(cato.token_sha256), tokenDigest(rotated));
    assert.equal(String(cato.kind), "owner");
    assert.equal(String(cato.owner_name), "Cato");
    assert.equal(rows.rows.filter((row) => row.name === "Cato").length, 1);
    const old = await post(ctx, { token: ctx.cato });
    assert.equal(old.status, 401);
    const current = await post(ctx, { token: rotated, key: "rotated" });
    assert.equal(current.status, 201);
    await assert.rejects(() => mintIngestToken(ctx.client, "operator"), /ledger, scout, or cato/);
  } finally {
    ctx.client.close();
  }
});

test("a principal can ingest only its allowed entity", async () => {
  const ctx = await setup();
  try {
    const scout = await post(ctx, { token: ctx.scout, entity: "tasks" });
    assert.equal(scout.status, 403);
    assert.deepEqual(scout.body, { detail: "not allowed" });
    const ledger = await post(ctx, { token: ctx.ledger, entity: "tasks", key: "ledger" });
    assert.equal(ledger.status, 403);
    const grocery = await post(ctx, { token: ctx.cato, entity: "grocery", key: "grocery" });
    assert.equal(grocery.status, 403);
    const tasks = await ctx.client.execute("SELECT COUNT(*) AS n FROM tasks");
    const activity = await ctx.client.execute("SELECT COUNT(*) AS n FROM bot_activity");
    assert.equal(Number(tasks.rows[0].n), 0);
    assert.equal(Number(activity.rows[0].n), 0);
  } finally {
    ctx.client.close();
  }
});

test("a bad body lists field names and no values", async () => {
  const ctx = await setup();
  try {
    const result = await post(ctx, {
      token: ctx.cato,
      body: { title: "", notes: SECRET, priority: "Urgent", assignee: "Cato" },
    });
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { fields: ["assignee", "priority", "title"] });
    const encoded = JSON.stringify(result.body);
    assert.equal(encoded.includes(SECRET), false);
    assert.equal(encoded.includes("Urgent"), false);
    const oversize = await post(ctx, {
      token: ctx.cato,
      key: "oversize",
      raw: `{"title":"${"x".repeat(20_000)}"}`,
    });
    assert.equal(oversize.status, 400);
    assert.deepEqual(oversize.body, { fields: ["body"] });
    assert.equal(JSON.stringify(oversize.body).includes("xxxx"), false);
    const broken = await post(ctx, { token: ctx.cato, key: "broken", raw: "not-json" });
    assert.deepEqual(broken.body, { fields: ["body"] });
    const missingKey = await post(ctx, { token: ctx.cato, key: null, raw: JSON.stringify({ title: TITLE }) });
    assert.equal(missingKey.status, 400);
    assert.deepEqual(missingKey.body, { fields: ["Idempotency-Key"] });
  } finally {
    ctx.client.close();
  }
});

test("the same idempotency key replays and a different body conflicts", async () => {
  const ctx = await setup();
  try {
    const raw = JSON.stringify({ title: TITLE, notes: "Synthetic example" });
    const first = await post(ctx, { token: ctx.cato, raw, key: "once" });
    assert.equal(first.status, 201);
    assert.equal(first.body.title, TITLE);
    const replay = await post(ctx, { token: ctx.cato, raw, key: "once" });
    assert.equal(replay.status, 201);
    assert.equal(replay.body.id, first.body.id);
    const other = await post(ctx, {
      token: ctx.cato,
      key: "once",
      raw: JSON.stringify({ title: "A different sample" }),
    });
    assert.equal(other.status, 409);
    assert.deepEqual(other.body, { detail: "That Idempotency-Key was already used." });
    assert.equal(JSON.stringify(other.body).includes(TITLE), false);
    assert.equal(JSON.stringify(other.body).includes("A different sample"), false);
    const spaced = await post(ctx, {
      token: ctx.cato,
      key: "spaced",
      raw: JSON.stringify({ title: TITLE }),
    });
    assert.equal(spaced.status, 201);
    const reordered = await post(ctx, {
      token: ctx.cato,
      key: "spaced",
      raw: JSON.stringify({ notes: "", title: TITLE }),
    });
    assert.equal(reordered.status, 409);
    const tasks = await ctx.client.execute("SELECT id FROM tasks");
    assert.deepEqual(
      tasks.rows.map((row) => String(row.id)).sort(),
      [first.body.id, spaced.body.id].sort(),
    );
    const activity = await ctx.client.execute("SELECT bot_name, action, detail, last_modified_by FROM bot_activity ORDER BY detail");
    assert.equal(activity.rows.length, 2);
    for (const row of activity.rows) {
      assert.equal(String(row.bot_name), "Cato");
      assert.equal(String(row.action), "ingest");
      assert.equal(String(row.last_modified_by), "Cato");
      assert.equal(String(row.detail).includes(TITLE), false);
      assert.match(String(row.detail), /^tasks:[0-9a-f-]{36}$/);
    }
    const saved = await ctx.client.execute("SELECT response_json FROM ingest_idempotency");
    assert.equal(JSON.stringify(saved.rows).includes(ctx.cato), false);
  } finally {
    ctx.client.close();
  }
});

test("an in-flight key waits instead of inserting a second task", async () => {
  const ctx = await setup();
  try {
    const principal = await ctx.client.execute("SELECT id FROM principals WHERE name = 'Cato'");
    const raw = JSON.stringify({ title: TITLE });
    await ctx.client.execute({
      sql: `INSERT INTO ingest_idempotency (
              principal_id, entity, idempotency_key, body_sha256, status_code, response_json, created_at
            ) VALUES (?, 'tasks', 'inflight', ?, 0, '', ?)`,
      args: [String(principal.rows[0].id), tokenDigest(raw), NOW],
    });
    const same = await post(ctx, { token: ctx.cato, raw, key: "inflight" });
    assert.equal(same.status, 503);
    const different = await post(ctx, {
      token: ctx.cato,
      key: "inflight",
      raw: JSON.stringify({ title: "Other sample" }),
    });
    assert.equal(different.status, 409);
    const tasks = await ctx.client.execute("SELECT COUNT(*) AS n FROM tasks");
    assert.equal(Number(tasks.rows[0].n), 0);
  } finally {
    ctx.client.close();
  }
});

test("the principal is limited in libSQL and the response carries Retry-After", async () => {
  const ctx = await setup();
  try {
    const first = await post(ctx, { token: ctx.cato, key: "r1", limit: 2 });
    const second = await post(ctx, { token: ctx.cato, key: "r2", limit: 2 });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const blocked = await post(ctx, { token: ctx.cato, key: "r3", limit: 2 });
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.body, { detail: "Too many requests." });
    assert.equal(blocked.retryAfter, 50);
    const response = withIngestHeaders(new Response(JSON.stringify(blocked.body)), blocked);
    assert.equal(response.headers.get("retry-after"), "50");
    const tasks = await ctx.client.execute("SELECT COUNT(*) AS n FROM tasks");
    assert.equal(Number(tasks.rows[0].n), 2);
  } finally {
    ctx.client.close();
  }
});

test("the default limit is 60 accepted requests in the window", async () => {
  const ctx = await setup();
  try {
    for (let index = 0; index < INGEST_RATE_LIMIT; index += 1) {
      const result = await post(ctx, { token: ctx.cato, key: `n-${index}` });
      assert.equal(result.status, 201);
    }
    const blocked = await post(ctx, { token: ctx.cato, key: "n-over" });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.retryAfter >= 1);
    const tasks = await ctx.client.execute("SELECT COUNT(*) AS n FROM tasks");
    assert.equal(Number(tasks.rows[0].n), 60);
  } finally {
    ctx.client.close();
  }
});

test("upstash mode does not open libSQL or Redis", async () => {
  const previous = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = () => {
    fetched += 1;
    throw new Error("redis");
  };
  const client = {
    execute() {
      throw new Error("database");
    },
    close() {},
  };
  try {
    const flagged = await handleIngest({
      entity: "tasks",
      rawBody: JSON.stringify({ title: TITLE }),
      headers: new Headers({ authorization: "Bearer jht_example" }),
      env: {
        JOEHUB_BACKEND_TASKS: "upstash",
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "token",
      },
      now: NOW,
      client,
    });
    assert.equal(flagged.status, 503);
    assert.deepEqual(flagged.body, { detail: "ingest not enabled" });
    const unset = await handleIngest({
      entity: "tasks",
      rawBody: "{}",
      headers: new Headers(),
      env: { VERCEL_ENV: "production" },
      now: NOW,
      client,
    });
    assert.deepEqual(unset.body, { detail: "ingest not enabled" });
    assert.equal(fetched, 0);
  } finally {
    globalThis.fetch = previous;
  }
});

test("a bearer token still works when a session cookie is also present", async () => {
  const ctx = await setup();
  try {
    const result = await post(ctx, {
      token: ctx.cato,
      cookie: "joehub_session=present",
      key: "with-cookie",
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.title, TITLE);
  } finally {
    ctx.client.close();
  }
});

test("the session gate lets ingest through and still requires a cookie for other APIs", async () => {
  const env = { NODE_ENV: "production", VERCEL_ENV: "production" };
  const ingest = await decide(
    new Request("http://127.0.0.1/api/ingest/tasks", { headers: { cookie: "joehub_session=abc" } }),
    env,
    NOW,
  );
  assert.equal(ingest.type, "next");
  const tasks = await decide(new Request("http://127.0.0.1/api/tasks", { headers: { cookie: "joehub_session=abc" } }), env, NOW);
  assert.equal(tasks.type, "json");
  assert.equal(tasks.status, 503);
});

test("minting refuses non-remote URLs unless --test is set", async () => {
  assert.doesNotThrow(() => assertIngestUrl("libsql://example.turso.io"));
  assert.doesNotThrow(() => assertIngestUrl("https://example.turso.io"));
  assert.throws(() => assertIngestUrl(":memory:"), /remote/);
  assert.throws(() => assertIngestUrl("file:/tmp/joehub-ingest.db"), /remote/);
  assert.throws(() => assertIngestUrl("http://127.0.0.1/db"), /remote/);
  assert.doesNotThrow(() => assertIngestUrl(":memory:", { test: true }));
  assert.throws(() => assertIngestUrl("libsql://example.turso.io", { test: true }), /--test/);

  const file = `/tmp/joehub-ingest-should-not-exist-${process.pid}.db`;
  const refused = await runNode(["scripts/ingest-token.mjs", "--url", `file:${file}`, "--principal", "cato"]);
  assert.notEqual(refused.code, 0);
  assert.equal(refused.stdout, "");
  assert.match(refused.stderr, /refusing to mint/);
  await assert.rejects(access(file));

  const minted = await runNode(["scripts/ingest-token.mjs", "--test", "--url", ":memory:", "--principal", "cato"]);
  assert.equal(minted.code, 0);
  assert.match(minted.stdout, /^jht_[A-Za-z0-9_-]+\n$/);
  assert.equal(minted.stderr, "");
  const digest = tokenDigest(minted.stdout.trim());
  assert.equal(minted.stdout.includes(digest), false);
});

test("the route stays off Redis and the production page pins are unchanged", async () => {
  const route = await readFile(new URL("../app/api/ingest/[entity]/route.ts", import.meta.url), "utf8");
  assert.match(route, /withIngestHeaders/);
  assert.doesNotMatch(route, /store\.mjs|store-upstash|apiLimiter|UPSTASH|redis/i);
  const handler = await readFile(new URL("../lib/ingest.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(handler, /joehub_session|createUpstash|UPSTASH|redis/i);
  for (const [file, pin] of [
    ["../lib/live-pages.mjs", "f0c23a7637db0ad4d3e6e1fe98837b9878f62098"],
    ["../lib/overlay-flag.mjs", "c3af66a42247cd7baf351e56a2736c1defc28245"],
  ]) {
    const bytes = await readFile(new URL(file, import.meta.url));
    const hash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(hash, pin);
  }
});
