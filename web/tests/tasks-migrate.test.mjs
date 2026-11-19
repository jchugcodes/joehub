import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";
import { handleIngest } from "../lib/ingest.mjs";
import { readLibsqlConfig } from "../lib/libsql-config.mjs";
import { readAreaBackends } from "../lib/backend.mjs";
import { createRuntime } from "../lib/store.mjs";
import { createSqliteStore } from "../lib/store-sqlite.mjs";
import { createUpstashStore } from "../lib/store-upstash.mjs";
import { assertSafeToStart } from "../lib/startup.mjs";
import { mintIngestToken } from "../scripts/ingest-token.mjs";
import { migrateLibsql } from "../scripts/libsql-migrate.mjs";
import { assertReadCommand, runExport } from "../scripts/tasks-export.mjs";
import { runImport } from "../scripts/tasks-import.mjs";
import { transformTasksSnapshot, runTransform } from "../scripts/tasks-transform.mjs";
import { formatVerifyReport, runVerify } from "../scripts/tasks-verify.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-11T16:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const FIXTURE = new URL("./fixtures/tasks-snapshot.json", import.meta.url);
const OPEN_ID = "11111111-1111-4111-8111-111111111111";
const LIST_ID = "22222222-2222-4222-8222-222222222222";
const OLD_ID = "44444444-4444-4444-8444-444444444444";
const SECRET = "test-session-secret";
const WRITES = new Set(["SET", "DEL", "ZADD", "ZREM", "INCR", "EXPIRE", "GETDEL", "SADD", "MSET", "UNLINK", "HSET"]);

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

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), "joehub-tasks-"));
  return {
    dir,
    file: path.join(dir, "tasks.db"),
    remove() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function taskCount(url) {
  if (!existsSync(url.startsWith("file:") ? url.slice("file:".length) : url)) return 0;
  const client = createClient({ url });
  try {
    const result = await client.execute("SELECT count(*) AS n FROM tasks");
    return Number(result.rows[0].n);
  } finally {
    client.close();
  }
}

test("libSQL config prefers the Joehub names and does not switch the area", () => {
  assert.deepEqual(
    readLibsqlConfig({
      JOEHUB_LIBSQL_URL: "libsql://joe.example",
      JOEHUB_LIBSQL_AUTH_TOKEN: "joe-token",
      TURSO_DATABASE_URL: "file:/tmp/joehub.db",
      TURSO_AUTH_TOKEN: "turso-token",
    }),
    { url: "libsql://joe.example", authToken: "joe-token" },
  );
  assert.deepEqual(
    readLibsqlConfig({
      JOEHUB_LIBSQL_URL: "  ",
      JOEHUB_LIBSQL_AUTH_TOKEN: "",
      TURSO_DATABASE_URL: "libsql://turso.example",
      TURSO_AUTH_TOKEN: "turso-token",
    }),
    { url: "libsql://turso.example", authToken: "turso-token" },
  );
  assert.deepEqual(readAreaBackends({ TURSO_DATABASE_URL: "libsql://turso.example", TURSO_AUTH_TOKEN: "turso-token" }), {
    tasks: "upstash",
    grocery: "upstash",
  });
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
  assert.doesNotThrow(() =>
    assertSafeToStart(
      oidc({
        VERCEL_ENV: "production",
        JOEHUB_ENV_SCOPE: "production",
        JOEHUB_BACKEND_TASKS: "sqlite",
        JOEHUB_LIBSQL_URL: "libsql://joe.example",
        JOEHUB_LIBSQL_AUTH_TOKEN: "joe-token",
        TURSO_DATABASE_URL: "file:/tmp/joehub.db",
        TURSO_AUTH_TOKEN: "turso-token",
      }),
    ),
  );
  assert.doesNotThrow(() =>
    assertSafeToStart(
      oidc({
        VERCEL_ENV: "production",
        JOEHUB_ENV_SCOPE: "production",
        JOEHUB_BACKEND_TASKS: "sqlite",
        TURSO_DATABASE_URL: "libsql://turso.example",
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
          JOEHUB_BACKEND_TASKS: "sqlite",
          TURSO_DATABASE_URL: "file:/tmp/joehub.db",
          TURSO_AUTH_TOKEN: "turso-token",
        }),
      ),
    /remote libsql:\/\/ or https:\/\//,
  );
});

test("the store uses the Joehub URL first and ignores Turso until the flag is sqlite", async () => {
  const box = scratch();
  const joe = path.join(box.dir, "joe.db");
  const turso = path.join(box.dir, "turso.db");
  try {
    const untouched = createRuntime({
      NODE_ENV: "development",
      TURSO_DATABASE_URL: `file:${turso}`,
      TURSO_AUTH_TOKEN: "turso-token",
    });
    const created = await untouched.store.createTask({ title: "Synthetic open task" }, "mem-1", NOW, "tasks");
    assert.equal(created.status, 201);
    assert.equal(existsSync(turso), false);

    await migrateLibsql({ url: `file:${joe}`, test: true });
    await migrateLibsql({ url: `file:${turso}`, test: true });
    const preferred = createRuntime({
      NODE_ENV: "development",
      VERCEL_ENV: "production",
      JOEHUB_BACKEND_TASKS: "sqlite",
      JOEHUB_LIBSQL_URL: `file:${joe}`,
      JOEHUB_LIBSQL_AUTH_TOKEN: "joe-token",
      TURSO_DATABASE_URL: `file:${turso}`,
      TURSO_AUTH_TOKEN: "turso-token",
    });
    assert.equal((await preferred.store.createTask({ title: "Synthetic open task" }, "joe-1", NOW, "tasks")).status, 201);
    assert.equal(await taskCount(`file:${joe}`), 1);
    assert.equal(await taskCount(`file:${turso}`), 0);

    const fallback = createRuntime({
      NODE_ENV: "development",
      VERCEL_ENV: "production",
      JOEHUB_BACKEND_TASKS: "sqlite",
      TURSO_DATABASE_URL: `file:${turso}`,
      TURSO_AUTH_TOKEN: "turso-token",
    });
    assert.equal((await fallback.store.createTask({ title: "Synthetic open task" }, "turso-1", NOW, "tasks")).status, 201);
    assert.equal(await taskCount(`file:${turso}`), 1);
    assert.equal(await taskCount(`file:${joe}`), 1);
  } finally {
    box.remove();
  }
});

test("export reads the Upstash fake and writes no task text", async () => {
  const fake = await startFakeUpstash();
  const box = scratch();
  const snapshot = path.join(box.dir, "snapshot.json");
  try {
    assert.throws(() => assertReadCommand(["SET", "joehub:task:example", "{}"]), /not a read/);
    const store = createUpstashStore({
      url: fake.url,
      token: fake.token,
      env: { VERCEL_ENV: "production" },
    });
    const list = await store.createList({ name: "Synthetic list", color: "#227777" }, NOW);
    await store.createTask(
      { title: "Synthetic open task", notes: "Synthetic note", project: list.body.id, sourceId: "notion:synthetic-page" },
      "export-open",
      NOW,
      "scope",
    );
    const old = await store.createTask(
      { title: "Synthetic old done task", notes: "older than seven days" },
      "export-old",
      NOW - 40 * DAY,
      "scope",
    );
    await store.completeTask(old.body.id, NOW - 40 * DAY);
    const mark = fake.commands.length;
    let printed = "";
    await assert.rejects(() => runExport(["--out", snapshot], { UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token }), /Joe's OK/);
    const result = await runExport(
      ["--i-have-joes-ok", "--out", snapshot],
      { UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token },
      { stdout: (text) => (printed += text) },
    );
    const used = fake.commands.slice(mark);
    assert.ok(used.some((command) => command[0] === "SCAN"));
    assert.equal(used.some((command) => WRITES.has(command[0])), false);
    assert.equal(printed.includes("Synthetic"), false);
    assert.match(printed, /tasks 2/);
    assert.match(printed, /lists 1/);
    assert.match(printed, new RegExp(`sha256 ${result.sha256}`));
    assert.equal(statSync(snapshot).mode & 0o777, 0o600);
    const file = await readFile(snapshot);
    assert.equal(printed.includes(result.sha256), true);
    const { createHash } = await import("node:crypto");
    assert.equal(createHash("sha256").update(file).digest("hex"), result.sha256);
  } finally {
    fake.stop();
    box.remove();
  }
});

test("a synthetic snapshot copies every task, including an old done task", async () => {
  const box = scratch();
  const snapshot = path.join(box.dir, "snapshot.json");
  const rowsPath = path.join(box.dir, "rows.json");
  const database = `file:${box.file}`;
  const previousExit = process.exitCode;
  try {
    const raw = JSON.parse(await readFile(FIXTURE, "utf8"));
    const rows = transformTasksSnapshot(raw);
    const open = rows.tasks.find((row) => row.id === OPEN_ID);
    const old = rows.tasks.find((row) => row.id === OLD_ID);
    assert.equal(open.source_id, "notion:synthetic-page");
    assert.equal(open.completed_at, null);
    assert.equal(open.body, JSON.stringify(raw.tasks.find((task) => task.id === OPEN_ID).body));
    assert.equal(old.completed_at, 1790870400000);
    assert.equal(rows.lists[0].id, LIST_ID);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(snapshot, await readFile(FIXTURE));
    let transformed = "";
    await runTransform(["--in", snapshot, "--out", rowsPath], { stdout: (text) => (transformed += text) });
    assert.equal(transformed.includes("Synthetic"), false);
    assert.match(transformed, /tasks 3/);
    await migrateLibsql({ url: database, test: true });
    let imported = "";
    await runImport(["--i-have-joes-ok", "--test", "--url", database, "--in", rowsPath], {}, { stdout: (text) => (imported += text) });
    assert.equal(imported.includes("Synthetic"), false);
    assert.equal(await taskCount(database), 3);
    let verified = "";
    const passed = await runVerify(
      ["--test", "--url", database, "--snapshot", snapshot, "--now", String(NOW)],
      {},
      { stdout: (text) => (verified += text), exitCode: false },
    );
    assert.equal(passed.ok, true);
    assert.match(verified, /^PASS\n/);
    assert.equal(verified.includes("Synthetic"), false);
    const client = createClient({ url: database });
    try {
      const store = createSqliteStore({ client, env: { VERCEL_ENV: "production" } });
      const found = await store.searchTasks("Synthetic old done task", NOW);
      assert.equal(found.some((task) => task.id === OLD_ID), true);
      const listed = await store.listUnfinishedTasks(NOW);
      assert.equal(listed.some((task) => task.id === OLD_ID), false);
      assert.equal(listed.some((task) => task.id === OPEN_ID), true);
    } finally {
      client.close();
    }
    await assert.rejects(
      () => runImport(["--i-have-joes-ok", "--test", "--url", database, "--in", rowsPath], {}, { stdout: () => {} }),
      /already has tasks/,
    );
    assert.equal(await taskCount(database), 3);
    await runImport(["--i-have-joes-ok", "--test", "--merge", "--url", database, "--in", rowsPath], {}, { stdout: () => {} });
    assert.equal(await taskCount(database), 3);

    const editor = createClient({ url: database });
    try {
      const row = await editor.execute({ sql: "SELECT body FROM tasks WHERE id = ?", args: [OLD_ID] });
      const body = JSON.parse(String(row.rows[0].body));
      body.title = "Synthetic altered task";
      await editor.execute({ sql: "UPDATE tasks SET body = ? WHERE id = ?", args: [JSON.stringify(body), OLD_ID] });
    } finally {
      editor.close();
    }
    let failed = "";
    const mismatch = await runVerify(
      ["--test", "--url", database, "--snapshot", snapshot, "--now", String(NOW)],
      {},
      { stdout: (text) => (failed += text), exitCode: false },
    );
    assert.equal(mismatch.ok, false);
    assert.equal(failed, formatVerifyReport(mismatch));
    assert.match(failed, /^FAIL\n/);
    assert.ok(mismatch.ids.includes(OLD_ID));
    assert.equal(failed.includes("Synthetic"), false);
    assert.equal(failed.includes("altered"), false);
    await runImport(["--i-have-joes-ok", "--test", "--merge", "--url", database, "--in", rowsPath], {}, { stdout: () => {} });
    const restored = await runVerify(
      ["--test", "--url", database, "--snapshot", snapshot, "--now", String(NOW)],
      {},
      { stdout: () => {}, exitCode: false },
    );
    assert.equal(restored.ok, true);
    assert.equal(await taskCount(database), 3);
  } finally {
    process.exitCode = previousExit;
    box.remove();
  }
});

test("import refuses a missing flag, a local URL, and a Turso file URL", async () => {
  const box = scratch();
  const rowsPath = path.join(box.dir, "rows.json");
  try {
    const rows = transformTasksSnapshot(JSON.parse(await readFile(FIXTURE, "utf8")));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(rowsPath, JSON.stringify(rows));
    await assert.rejects(() => runImport(["--test", "--url", ":memory:", "--in", rowsPath]), /Joe's OK/);
    await assert.rejects(() => runImport(["--i-have-joes-ok", "--url", ":memory:", "--in", rowsPath]), /--test/);
    await assert.rejects(() => runImport(["--i-have-joes-ok", "--url", `file:${box.file}`, "--in", rowsPath]), /--test/);
    await assert.rejects(
      () => runImport(["--i-have-joes-ok", "--in", rowsPath], { TURSO_DATABASE_URL: "file:/tmp/joehub.db", TURSO_AUTH_TOKEN: "turso-token" }),
      /--test/,
    );
    await assert.rejects(() => runVerify(["--url", "file:/tmp/joehub.db", "--snapshot", FIXTURE.pathname]), /--test/);
  } finally {
    box.remove();
  }
});

test("ingest follows the same libSQL names", async () => {
  const box = scratch();
  const joe = path.join(box.dir, "joe.db");
  const turso = path.join(box.dir, "turso.db");
  try {
    await migrateLibsql({ url: `file:${joe}`, test: true });
    await migrateLibsql({ url: `file:${turso}`, test: true });
    const joeClient = createClient({ url: `file:${joe}` });
    const tursoClient = createClient({ url: `file:${turso}` });
    const joeToken = await mintIngestToken(joeClient, "cato", new Date(NOW));
    const tursoToken = await mintIngestToken(tursoClient, "cato", new Date(NOW));
    joeClient.close();
    tursoClient.close();
    const headers = (token) => new Headers({ authorization: `Bearer ${token}`, "idempotency-key": "synthetic-1" });
    const preferred = await handleIngest({
      entity: "tasks",
      rawBody: JSON.stringify({ title: "Synthetic open task" }),
      headers: headers(joeToken),
      now: NOW,
      env: {
        JOEHUB_BACKEND_TASKS: "sqlite",
        VERCEL_ENV: "production",
        JOEHUB_LIBSQL_URL: `file:${joe}`,
        JOEHUB_LIBSQL_AUTH_TOKEN: "joe-token",
        TURSO_DATABASE_URL: `file:${turso}`,
        TURSO_AUTH_TOKEN: "turso-token",
      },
    });
    assert.equal(preferred.status, 201);
    assert.equal(await taskCount(`file:${joe}`), 1);
    assert.equal(await taskCount(`file:${turso}`), 0);
    const fallback = await handleIngest({
      entity: "tasks",
      rawBody: JSON.stringify({ title: "Synthetic open task" }),
      headers: headers(tursoToken),
      now: NOW,
      env: {
        JOEHUB_BACKEND_TASKS: "sqlite",
        VERCEL_ENV: "production",
        TURSO_DATABASE_URL: `file:${turso}`,
        TURSO_AUTH_TOKEN: "turso-token",
      },
    });
    assert.equal(fallback.status, 201);
    assert.equal(await taskCount(`file:${turso}`), 1);
  } finally {
    box.remove();
  }
});
