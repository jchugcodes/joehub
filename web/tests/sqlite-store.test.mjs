import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { readAreaBackends } from "../lib/backend.mjs";
import { createRuntime } from "../lib/store.mjs";
import { createSqliteStore, TASKS_DDL } from "../lib/store-sqlite.mjs";
import { createUpstashStore } from "../lib/store-upstash.mjs";
import { assertSafeToStart } from "../lib/startup.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-11T11:42:00.000Z");
const SECRET = "test-session-secret";

function oidc(extra = {}) {
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

async function openTasks() {
  const client = createClient({ url: ":memory:" });
  for (const sql of TASKS_DDL) await client.execute(sql);
  return client;
}

async function taskCount(client) {
  const result = await client.execute("SELECT count(*) AS n FROM tasks");
  return Number(result.rows[0].n);
}

async function scenario(store, now) {
  const blank = await store.createTask({ title: "   " }, "blank", now);
  const created = await store.createTask(
    {
      title: "Pack the sample",
      notes: "Alpha note",
      dueDate: "2026-11-20",
      priority: "High",
      status: "To do",
      project: "Errands",
    },
    "create-1",
    now,
    "tasks",
  );
  const replay = await store.createTask({ title: "Other title" }, "create-1", now + 10, "tasks");
  const fetched = await store.getTask(created.body.id);
  const patched = await store.patchTask(created.body.id, { notes: "Edited note", status: "Doing" }, now + 20);
  const listed = await store.listUnfinishedTasks(now + 20);
  const found = await store.searchTasks("edited", now + 20);
  const missed = await store.searchTasks("no-such-word", now + 20);
  const done = await store.completeTask(created.body.id, now + 30);
  const listedDone = await store.listUnfinishedTasks(now + 30);
  const foundDone = await store.searchTasks("edited", now + 30);
  const reopened = await store.reopenTask(created.body.id, now + 40);
  const missingGet = await store.getTask("missing");
  const missingPatch = await store.patchTask("missing", { title: "Nope" }, now + 50);
  const missingDelete = await store.deleteTask("not-a-real-id");
  const removed = await store.deleteTask(created.body.id);
  const after = await store.listUnfinishedTasks(now + 60);
  const imported = await store.createTask(
    { title: "Imported", notes: "from notion", sourceId: "notion:page-1" },
    "src-1",
    now + 70,
  );
  const importedAgain = await store.createTask(
    { title: "Imported edited", notes: "changed", sourceId: "notion:page-1" },
    "src-2",
    now + 80,
  );
  const importedGet = await store.getTask(imported.body.id);
  return {
    blank,
    created,
    replay,
    fetched,
    patched,
    listed,
    found,
    missed,
    done,
    listedDone,
    foundDone,
    reopened,
    missingGet,
    missingPatch,
    missingDelete,
    removed,
    after,
    imported,
    importedAgain,
    importedGet,
  };
}

test("tasks flag defaults to upstash and rejects an unknown value", () => {
  assert.deepEqual(readAreaBackends({}), { tasks: "upstash" });
  assert.deepEqual(readAreaBackends({ JOEHUB_BACKEND_TASKS: "  " }), { tasks: "upstash" });
  assert.deepEqual(readAreaBackends({ JOEHUB_BACKEND_TASKS: "upstash" }), { tasks: "upstash" });
  assert.deepEqual(readAreaBackends({ JOEHUB_BACKEND_TASKS: "sqlite" }), { tasks: "sqlite" });
  assert.throws(() => readAreaBackends({ JOEHUB_BACKEND_TASKS: "postgres" }), /unknown JOEHUB_BACKEND_TASKS/);
  assert.throws(() => readAreaBackends({ JOEHUB_BACKEND_TASKS: "SQLite" }), /unknown JOEHUB_BACKEND_TASKS/);
});

test("startup allows a remote libSQL URL only when an area is sqlite", () => {
  assert.doesNotThrow(() => assertSafeToStart(oidc()));
  assert.doesNotThrow(() =>
    assertSafeToStart(
      oidc({
        VERCEL_ENV: "production",
        JOEHUB_ENV_SCOPE: "production",
        JOEHUB_BACKEND_TASKS: "sqlite",
        JOEHUB_LIBSQL_URL: "libsql://joehub-example.turso.io",
        JOEHUB_LIBSQL_AUTH_TOKEN: "token-value",
      }),
    ),
  );
  assert.doesNotThrow(() =>
    assertSafeToStart(
      oidc({
        VERCEL_ENV: "production",
        JOEHUB_ENV_SCOPE: "production",
        JOEHUB_BACKEND_TASKS: "sqlite",
        JOEHUB_LIBSQL_URL: "https://joehub-example.turso.io",
        JOEHUB_LIBSQL_AUTH_TOKEN: "token-value",
      }),
    ),
  );
  assert.throws(
    () =>
      assertSafeToStart(
        oidc({
          VERCEL_ENV: "production",
          JOEHUB_ENV_SCOPE: "production",
          JOEHUB_BACKEND_TASKS: "sqlite",
          JOEHUB_LIBSQL_URL: "file:/tmp/joehub.db",
          JOEHUB_LIBSQL_AUTH_TOKEN: "token-value",
        }),
      ),
    /remote libsql:\/\/ or https:\/\//,
  );
  assert.throws(
    () =>
      assertSafeToStart(
        oidc({
          VERCEL_ENV: "preview",
          JOEHUB_ENV_SCOPE: "preview",
          JOEHUB_BACKEND_TASKS: "sqlite",
          JOEHUB_LIBSQL_URL: ":memory:",
          JOEHUB_LIBSQL_AUTH_TOKEN: "token-value",
        }),
      ),
    /remote libsql:\/\/ or https:\/\//,
  );
  assert.throws(
    () =>
      assertSafeToStart(
        oidc({
          VERCEL_ENV: "preview",
          JOEHUB_ENV_SCOPE: "preview",
          JOEHUB_BACKEND_TASKS: "sqlite",
          JOEHUB_LIBSQL_URL: "http://joehub-example.turso.io",
          JOEHUB_LIBSQL_AUTH_TOKEN: "token-value",
        }),
      ),
    /remote libsql:\/\/ or https:\/\//,
  );
  assert.throws(
    () =>
      assertSafeToStart(
        oidc({
          VERCEL_ENV: "production",
          JOEHUB_ENV_SCOPE: "production",
          JOEHUB_BACKEND_TASKS: "sqlite",
          JOEHUB_LIBSQL_URL: "libsql://joehub-example.turso.io",
        }),
      ),
    /auth token is missing/,
  );
  assert.throws(
    () => assertSafeToStart({ NODE_ENV: "development", JOEHUB_DEV_AUTH: "1", JOEHUB_BACKEND_TASKS: "redis" }),
    /unknown JOEHUB_BACKEND_TASKS/,
  );
  assert.throws(
    () =>
      assertSafeToStart({
        NODE_ENV: "development",
        JOEHUB_DEV_AUTH: "1",
        JOEHUB_BACKEND_TASKS: "sqlite",
        JOEHUB_LIBSQL_URL: "file:/tmp/joehub.db",
        JOEHUB_DB_PATH: "/tmp/joehub.db",
      }),
    /database, age key, or operator settings/,
  );
  assert.doesNotThrow(() =>
    assertSafeToStart({
      NODE_ENV: "development",
      JOEHUB_DEV_AUTH: "1",
      JOEHUB_SESSION_SECRET: SECRET,
      JOEHUB_BACKEND_TASKS: "sqlite",
      JOEHUB_LIBSQL_URL: "file:/tmp/joehub.db",
    }),
  );
  assert.doesNotThrow(() =>
    assertSafeToStart({
      NODE_ENV: "development",
      JOEHUB_DEV_AUTH: "1",
      JOEHUB_SESSION_SECRET: SECRET,
      JOEHUB_BACKEND_TASKS: "sqlite",
      JOEHUB_LIBSQL_URL: ":memory:",
    }),
  );
});

test("sqlite tasks match upstash and other areas stay unmigrated", async () => {
  const quiet = { VERCEL_ENV: "production" };
  const fake = await startFakeUpstash();
  const seedFake = await startFakeUpstash();
  const client = await openTasks();
  const seeded = await openTasks();
  try {
    const upstash = createUpstashStore({ url: fake.url, token: fake.token, env: quiet });
    const sqlite = createSqliteStore({ client, env: quiet });
    assert.deepEqual(await scenario(sqlite, NOW), await scenario(upstash, NOW));

    const upstashSeed = createUpstashStore({ url: seedFake.url, token: seedFake.token, env: {} });
    const sqliteSeed = createSqliteStore({ client: seeded, env: {} });
    assert.deepEqual(await sqliteSeed.listUnfinishedTasks(NOW), await upstashSeed.listUnfinishedTasks(NOW));

    assert.throws(() => sqlite.listGrocery(), /not migrated/);
    assert.throws(() => sqlite.listLists(), /not migrated/);
    assert.throws(() => sqlite.financeGoals(), /not migrated/);
    assert.throws(() => sqlite.getSession("session", NOW), /not migrated/);

    const bare = createClient({ url: ":memory:" });
    const unmigrated = createSqliteStore({ client: bare, env: quiet });
    await assert.rejects(() => unmigrated.listUnfinishedTasks(NOW));
    bare.close();
  } finally {
    client.close();
    seeded.close();
    fake.stop();
    seedFake.stop();
  }
});

test("the tasks flag selects sqlite for tasks and leaves the rest on the current store", async () => {
  const fake = await startFakeUpstash();
  const client = await openTasks();
  const ignored = await openTasks();
  try {
    const quiet = {
      VERCEL_ENV: "production",
      UPSTASH_REDIS_REST_URL: fake.url,
      UPSTASH_REDIS_REST_TOKEN: fake.token,
      JOEHUB_BACKEND_TASKS: "sqlite",
    };
    const selected = createRuntime(quiet, { tasksClient: client });
    const before = fake.commands.length;
    const created = await selected.store.createTask({ title: "Only sqlite" }, "sel-1", NOW);
    assert.equal(created.status, 201);
    assert.equal(fake.commands.length, before);
    assert.equal(await taskCount(client), 1);
    assert.equal(await selected.store.getSession("not-a-session", NOW), null);
    assert.ok(fake.commands.length > before);
    assert.equal(await taskCount(client), 1);

    const memory = createRuntime({ NODE_ENV: "development" }, { tasksClient: ignored });
    await memory.store.createTask({ title: "Stays in memory" }, "mem-1", NOW);
    assert.equal(await taskCount(ignored), 0);
    assert.throws(() => createRuntime({ JOEHUB_BACKEND_TASKS: "sqlite" }), /libSQL URL is missing/);
    assert.throws(() => createRuntime({ JOEHUB_BACKEND_TASKS: "postgres" }), /unknown JOEHUB_BACKEND_TASKS/);
  } finally {
    client.close();
    ignored.close();
    fake.stop();
  }
});
