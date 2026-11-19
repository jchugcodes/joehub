import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { readAreaBackends } from "../lib/backend.mjs";
import { createRuntime } from "../lib/store.mjs";
import { migrateLibsql } from "../scripts/libsql-migrate.mjs";
import { createSqliteStore } from "../lib/store-sqlite.mjs";
import { createUpstashStore } from "../lib/store-upstash.mjs";
import { assertSafeToStart } from "../lib/startup.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const SECRET = "grocery-sqlite-secret";

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

function groceryKey(command) {
  return command.some((part) => typeof part === "string" && part.includes("joehub:grocery"));
}

function taskKey(command) {
  return command.some((part) => typeof part === "string" && /joehub:tasks?(?::|$)/.test(part));
}

async function openGrocery() {
  const client = createClient({ url: ":memory:" });
  await migrateLibsql({ client, url: ":memory:", test: true });
  return client;
}

async function scenario(store, now) {
  const empty = await store.listGrocery(now);
  const blank = await store.createGrocery({ name: "  " }, "blank", now, "owner");
  const badQty = await store.createGrocery({ name: "Bad", quantity: "- 2" }, "bad-qty", now, "owner");
  const extra = await store.createGrocery({ name: "Nope", mystery: true }, "extra", now, "owner");
  const created = await store.createGrocery(
    { name: "Sourdough", quantity: "1 loaf", notes: "Seeded starter", section: "Bakery" },
    "create-1",
    now,
    "owner",
  );
  const replay = await store.createGrocery({ name: "Other" }, "create-1", now + 5, "owner");
  const otherScope = await store.createGrocery({ name: "Other scope" }, "create-1", now + 6, "other");
  const fetched = await store.getGrocery(created.body.id);
  const missingGet = await store.getGrocery("missing");
  const patched = await store.patchGrocery(created.body.id, { notes: "", quantity: "2 loaves" }, now + 10);
  const patchedGet = await store.getGrocery(created.body.id);
  const tieA = await store.createGrocery({ name: "Alpha tie" }, "tie-a", now + 20, "owner");
  const tieB = await store.createGrocery({ name: "Beta tie" }, "tie-b", now + 20, "owner");
  const tied = (await store.listGrocery(now + 20))
    .filter((item) => item.id === tieA.body.id || item.id === tieB.body.id)
    .map((item) => item.id);
  const checked = await store.checkGrocery(created.body.id, now + 30);
  const checkedAgain = await store.checkGrocery(created.body.id, now + 40);
  const listed = (await store.listGrocery(now + 40)).map((item) => item.id);
  const unchecked = await store.uncheckGrocery(created.body.id, now + 50);
  const missingCheck = await store.checkGrocery("nope", now + 60);
  const missingUncheck = await store.uncheckGrocery("nope", now + 60);
  const missingPatch = await store.patchGrocery("nope", { name: "Nope" }, now + 60);
  const missingDelete = await store.deleteGrocery("nope");
  await store.checkGrocery(tieA.body.id, now + 70);
  const cleared = await store.clearGrocery();
  const afterClear = (await store.listGrocery()).map((item) => item.name);
  const none = await store.clearGrocery();
  const imported = await store.createGrocery(
    { name: "Imported oats", quantity: "1 bag", sourceId: "notion:oats" },
    "src-1",
    now + 80,
    "owner",
  );
  const importedAgain = await store.createGrocery(
    { name: "Imported oats edited", quantity: "2", notes: "", sourceId: "notion:oats" },
    "src-2",
    now + 90,
    "owner",
  );
  const importedGet = await store.getGrocery(imported.body.id);
  const removed = await store.deleteGrocery(imported.body.id);
  const gone = await store.getGrocery(imported.body.id);
  const longNotes = await store.createGrocery({ name: "Notes", notes: "x".repeat(4001) }, "long", now + 100, "owner");
  const badId = await store.checkGrocery("has spaces", now + 110);
  return {
    empty,
    blank,
    badQty,
    extra,
    created,
    replay,
    otherScope,
    fetched,
    missingGet,
    patched,
    patchedGet,
    tied,
    checked,
    checkedAgain,
    listed,
    unchecked,
    missingCheck,
    missingUncheck,
    missingPatch,
    missingDelete,
    cleared,
    afterClear,
    none,
    imported,
    importedAgain,
    importedGet,
    removed,
    gone,
    longNotes,
    badId,
  };
}

test("grocery flag defaults to upstash and uses the same remote libSQL check", () => {
  assert.deepEqual(readAreaBackends({}), { tasks: "upstash", grocery: "upstash" });
  assert.deepEqual(readAreaBackends({ JOEHUB_BACKEND_GROCERY: "  " }), { tasks: "upstash", grocery: "upstash" });
  assert.deepEqual(readAreaBackends({ JOEHUB_BACKEND_GROCERY: "sqlite" }), { tasks: "upstash", grocery: "sqlite" });
  assert.deepEqual(readAreaBackends({ TURSO_DATABASE_URL: "libsql://turso.example", TURSO_AUTH_TOKEN: "turso-token" }), {
    tasks: "upstash",
    grocery: "upstash",
  });
  assert.throws(() => readAreaBackends({ JOEHUB_BACKEND_GROCERY: "postgres" }), /unknown JOEHUB_BACKEND_GROCERY/);
  assert.doesNotThrow(() =>
    assertSafeToStart(
      oidc({
        VERCEL_ENV: "production",
        JOEHUB_ENV_SCOPE: "production",
        TURSO_DATABASE_URL: "file:/tmp/joehub.db",
        TURSO_AUTH_TOKEN: "turso-token",
      }),
    ),
  );
  assert.throws(
    () =>
      assertSafeToStart(
        oidc({
          VERCEL_ENV: "production",
          JOEHUB_ENV_SCOPE: "production",
          JOEHUB_BACKEND_GROCERY: "sqlite",
          TURSO_DATABASE_URL: "file:/tmp/joehub.db",
          TURSO_AUTH_TOKEN: "turso-token",
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
          JOEHUB_BACKEND_GROCERY: "sqlite",
          JOEHUB_LIBSQL_URL: "libsql://joehub-example.turso.io",
        }),
      ),
    /auth token is missing/,
  );
  assert.doesNotThrow(() =>
    assertSafeToStart(
      oidc({
        VERCEL_ENV: "production",
        JOEHUB_ENV_SCOPE: "production",
        JOEHUB_BACKEND_GROCERY: "sqlite",
        TURSO_DATABASE_URL: "libsql://turso.example",
        TURSO_AUTH_TOKEN: "turso-token",
      }),
    ),
  );
  assert.doesNotThrow(() =>
    assertSafeToStart({
      NODE_ENV: "development",
      JOEHUB_DEV_AUTH: "1",
      JOEHUB_SESSION_SECRET: SECRET,
      JOEHUB_BACKEND_GROCERY: "sqlite",
      JOEHUB_LIBSQL_URL: "file:/tmp/joehub.db",
    }),
  );
  assert.doesNotThrow(() =>
    assertSafeToStart({
      NODE_ENV: "development",
      JOEHUB_DEV_AUTH: "1",
      JOEHUB_SESSION_SECRET: SECRET,
      JOEHUB_BACKEND_GROCERY: "sqlite",
      JOEHUB_LIBSQL_URL: ":memory:",
    }),
  );
});

test("sqlite grocery matches upstash, including checks, source ids, and list order", async () => {
  const fake = await startFakeUpstash();
  const seedFake = await startFakeUpstash();
  const client = await openGrocery();
  const seeded = await openGrocery();
  try {
    const quiet = { VERCEL_ENV: "production" };
    const upstash = createUpstashStore({ url: fake.url, token: fake.token, env: quiet });
    const sqlite = createSqliteStore({ client, env: quiet });
    assert.deepEqual(await scenario(sqlite, NOW), await scenario(upstash, NOW));

    const upstashSeed = createUpstashStore({ url: seedFake.url, token: seedFake.token, env: {} });
    const sqliteSeed = createSqliteStore({ client: seeded, env: {} });
    assert.deepEqual(await sqliteSeed.listGrocery(NOW), await upstashSeed.listGrocery(NOW));
    assert.deepEqual(await sqliteSeed.listGrocery(NOW), await upstashSeed.listGrocery(NOW));
  } finally {
    client.close();
    seeded.close();
    fake.stop();
    seedFake.stop();
  }
});

test("the grocery flag does not read grocery keys and leaves tasks on upstash", async () => {
  const fake = await startFakeUpstash();
  const client = await openGrocery();
  const tasksClient = await openGrocery();
  try {
    const selected = createRuntime(
      {
        VERCEL_ENV: "production",
        UPSTASH_REDIS_REST_URL: fake.url,
        UPSTASH_REDIS_REST_TOKEN: fake.token,
        JOEHUB_BACKEND_GROCERY: "sqlite",
        JOEHUB_LIBSQL_URL: "libsql://example.turso.io",
      },
      { groceryClient: client },
    );
    const before = fake.commands.length;
    const created = await selected.store.createGrocery({ name: "Only sqlite" }, "g-1", NOW, "owner");
    assert.equal(created.status, 201);
    await selected.store.listGrocery(NOW);
    await selected.store.getGrocery(created.body.id);
    await selected.store.patchGrocery(created.body.id, { section: "Pantry" }, NOW + 1);
    await selected.store.checkGrocery(created.body.id, NOW + 2);
    await selected.store.uncheckGrocery(created.body.id, NOW + 3);
    await selected.store.clearGrocery();
    await selected.store.deleteGrocery(created.body.id);
    assert.equal(fake.commands.slice(before).some(groceryKey), false);
    const task = await selected.store.createTask({ title: "Still upstash" }, "t-1", NOW, "tasks");
    assert.equal(task.status, 201);
    assert.equal(fake.commands.some(taskKey), true);
    const tasks = await client.execute("SELECT count(*) AS n FROM tasks");
    assert.equal(Number(tasks.rows[0].n), 0);

    const tasksOnly = createRuntime(
      {
        VERCEL_ENV: "production",
        UPSTASH_REDIS_REST_URL: fake.url,
        UPSTASH_REDIS_REST_TOKEN: fake.token,
        JOEHUB_BACKEND_TASKS: "sqlite",
        JOEHUB_LIBSQL_URL: "libsql://example.turso.io",
      },
      { tasksClient },
    );
    const mark = fake.commands.length;
    const item = await tasksOnly.store.createGrocery({ name: "Still redis" }, "g-2", NOW, "owner");
    assert.equal(item.status, 201);
    assert.equal(fake.commands.slice(mark).some(groceryKey), true);
    const groceryRows = await tasksClient.execute("SELECT count(*) AS n FROM grocery_items");
    assert.equal(Number(groceryRows.rows[0].n), 0);
    assert.throws(() => createRuntime({ JOEHUB_BACKEND_GROCERY: "sqlite" }), /libSQL URL is missing/);
  } finally {
    client.close();
    tasksClient.close();
    fake.stop();
  }
});
