import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import {
  addColumnTarget,
  assertAppendOnly,
  assertMigratableUrl,
  migrateLibsql,
  sqlStatements,
} from "../scripts/libsql-migrate.mjs";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const REPO = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = path.join(WEB, "scripts", "libsql-migrate.mjs");
const LIBSQL = path.join(WEB, "migrations-libsql");
const BOX = [
  "accounts",
  "application_status_history",
  "applications",
  "bot_activity",
  "budgets",
  "categories",
  "companies",
  "contacts",
  "delegations",
  "errors",
  "events",
  "export_history",
  "goals",
  "journal_entries",
  "locks",
  "owners",
  "pending_deletes",
  "principals",
  "schema_migrations",
  "table_registry",
  "transactions",
  "write_queue",
];

const PYTHON_SCHEMA = `
import json, sqlite3, pathlib, sys
root = pathlib.Path(sys.argv[1])
conn = sqlite3.connect(":memory:")
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA foreign_keys = ON")

def statements(script):
    out = []
    buffer = ""
    for line in script.splitlines():
        if not buffer and line.strip().startswith("--"):
            continue
        buffer += line + "\\n"
        if sqlite3.complete_statement(buffer):
            text = buffer.strip()
            buffer = ""
            if text and not text.startswith("--"):
                out.append(text)
    if buffer.strip():
        raise SystemExit("incomplete")
    return out

for name in ("001_initial.sql", "002_writers_and_registry.sql"):
    script = (root / "migrations" / name).read_text(encoding="utf-8")
    conn.execute("BEGIN IMMEDIATE")
    try:
        for statement in statements(script):
            if statement.upper().startswith("PRAGMA"):
                continue
            conn.execute(statement)
        conn.commit()
    except Exception:
        conn.rollback()
        raise

def rows(sql):
    return [list(row) for row in conn.execute(sql)]

tables = json.loads(sys.argv[2])
result = {}
for table in tables:
    quoted = '"' + table.replace('"', '""') + '"'
    indexes = rows(f"PRAGMA index_list({quoted})")
    info = {}
    for index in indexes:
        info[index[1]] = rows('PRAGMA index_info("' + index[1].replace('"', '""') + '")')
    result[table] = {
        "table_info": rows(f"PRAGMA table_info({quoted})"),
        "foreign_key_list": rows(f"PRAGMA foreign_key_list({quoted})"),
        "index_list": indexes,
        "index_info": info,
        "triggers": [
            [row[0], row[1]]
            for row in conn.execute(
                "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name",
                (table,),
            )
        ],
    }
print(json.dumps(result))
`;

function cell(value) {
  if (typeof value === "bigint") return Number(value);
  return value === undefined ? null : value;
}

function cells(row, names) {
  return names.map((name) => cell(row[name]));
}

async function libsqlSchema(client) {
  const result = {};
  for (const table of BOX) {
    const info = await client.execute(`PRAGMA table_info("${table}")`);
    const foreignKeys = await client.execute(`PRAGMA foreign_key_list("${table}")`);
    const indexes = await client.execute(`PRAGMA index_list("${table}")`);
    const indexInfo = {};
    for (const index of indexes.rows) {
      const name = String(index.name);
      const columns = await client.execute(`PRAGMA index_info("${name.replaceAll('"', '""')}")`);
      indexInfo[name] = columns.rows.map((row) => cells(row, ["seqno", "cid", "name"]));
    }
    const triggers = await client.execute({
      sql: "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name",
      args: [table],
    });
    result[table] = {
      table_info: info.rows.map((row) => cells(row, ["cid", "name", "type", "notnull", "dflt_value", "pk"])),
      foreign_key_list: foreignKeys.rows.map((row) => cells(row, ["id", "seq", "table", "from", "to", "on_update", "on_delete", "match"])),
      index_list: indexes.rows.map((row) => cells(row, ["seq", "name", "unique", "origin", "partial"])),
      index_info: indexInfo,
      triggers: triggers.rows.map((row) => [String(row.name), row.sql == null ? null : String(row.sql)]),
    };
  }
  return result;
}

function pythonSchema() {
  const run = spawnSync("python3", ["-c", PYTHON_SCHEMA, REPO, JSON.stringify(BOX)], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}

test("001 and 002 are the box migrations, byte for byte", async () => {
  for (const name of ["001_initial.sql", "002_writers_and_registry.sql"]) {
    const box = await readFile(path.join(REPO, "migrations", name));
    const copy = await readFile(path.join(LIBSQL, name));
    assert.deepEqual(copy, box);
  }
});

test("local libSQL URLs are refused unless --test is passed", () => {
  assert.throws(() => assertMigratableUrl(""), /URL is missing/);
  assert.throws(() => assertMigratableUrl(":memory:"), /need --test/);
  assert.throws(() => assertMigratableUrl("file:dev.db"), /need --test/);
  assert.throws(() => assertMigratableUrl("file:///tmp/joehub.db"), /need --test/);
  assert.throws(() => assertMigratableUrl("FILE:/tmp/joehub.db"), /need --test/);
  assert.doesNotThrow(() => assertMigratableUrl(":memory:", { test: true }));
  assert.doesNotThrow(() => assertMigratableUrl("file:/tmp/joehub.db", { test: true }));
  assert.doesNotThrow(() => assertMigratableUrl("libsql://example.turso.io"));
  assert.doesNotThrow(() => assertMigratableUrl("https://example.turso.io"));
  assert.throws(() => assertAppendOnly("DROP TABLE tasks;", "003_tasks.sql"), /append-only/);
  assert.deepEqual(addColumnTarget("ALTER TABLE locks ADD COLUMN fence INTEGER NOT NULL DEFAULT 0;"), {
    table: "locks",
    column: "fence",
  });
});

test("the migrator does not open a file database without --test", () => {
  const db = path.join(tmpdir(), "joehub-s2-not-created.db");
  const run = spawnSync(process.execPath, [SCRIPT], {
    cwd: WEB,
    env: { ...process.env, JOEHUB_LIBSQL_URL: `file:${db}`, JOEHUB_LIBSQL_AUTH_TOKEN: "" },
    encoding: "utf8",
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /need --test/);
  assert.equal(existsSync(db), false);
});

test("a remote URL without a token is refused before any connection", async () => {
  const previous = process.env.JOEHUB_LIBSQL_AUTH_TOKEN;
  delete process.env.JOEHUB_LIBSQL_AUTH_TOKEN;
  try {
    await assert.rejects(
      () => migrateLibsql({ url: "libsql://example.turso.io" }),
      /auth token is missing/,
    );
  } finally {
    if (previous === undefined) delete process.env.JOEHUB_LIBSQL_AUTH_TOKEN;
    else process.env.JOEHUB_LIBSQL_AUTH_TOKEN = previous;
  }
});

test("migrations match Python sqlite3 for the 22 box tables and record each file", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    const first = await migrateLibsql({ client, url: ":memory:", test: true });
    assert.deepEqual(first, [
      "001_initial.sql",
      "002_writers_and_registry.sql",
      "003_tasks.sql",
      "004_grocery_and_lists.sql",
      "005_ingest.sql",
      "006_grocery_documents.sql",
      "007_finance_reads.sql",
      "008_finance_writes.sql",
    ]);
    const second = await migrateLibsql({ client, url: ":memory:", test: true });
    assert.deepEqual(second, []);

    const recorded = await client.execute(
      "SELECT length(id) AS id_len, notion_id, migrated_on, last_modified_by, last_modified_at, version, applied_at FROM schema_migrations ORDER BY version",
    );
    assert.deepEqual(
      recorded.rows.map((row) => String(row.version)),
      ["001_initial.sql", "002_writers_and_registry.sql", "003_tasks.sql", "004_grocery_and_lists.sql", "005_ingest.sql", "006_grocery_documents.sql", "007_finance_reads.sql", "008_finance_writes.sql"],
    );
    for (const row of recorded.rows) {
      assert.equal(Number(row.id_len), 36);
      assert.equal(row.notion_id, null);
      assert.equal(row.migrated_on, null);
      assert.equal(String(row.last_modified_by), "system");
      assert.equal(String(row.last_modified_at), String(row.applied_at));
      assert.match(String(row.applied_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }

    const actual = await libsqlSchema(client);
    const expected = pythonSchema();
    for (const table of BOX) {
      assert.deepEqual(actual[table], expected[table], table);
    }

    const names = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    assert.deepEqual(
      names.rows.map((row) => String(row.name)),
      [...BOX, "finance_blobs", "finance_docs", "finance_goal_status", "finance_idem", "finance_ids", "finance_sources", "grocery_flags", "grocery_idempotency", "grocery_items", "ingest_idempotency", "ingest_rate", "lists", "task_flags", "task_idempotency", "tasks"].sort(),
    );
    const tasks = await client.execute("PRAGMA table_info(tasks)");
    assert.deepEqual(
      tasks.rows.map((row) => [String(row.name), String(row.type), Number(row.notnull), Number(row.pk)]),
      [
        ["id", "TEXT", 0, 1],
        ["body", "TEXT", 1, 0],
        ["status", "TEXT", 1, 0],
        ["created_at", "INTEGER", 1, 0],
        ["completed_at", "INTEGER", 0, 0],
        ["source_id", "TEXT", 0, 0],
      ],
    );
  } finally {
    client.close();
  }
});

test("an existing column is skipped when a later migration adds it again", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "joehub-migrate-"));
  await writeFile(
    path.join(dir, "001_sample.sql"),
    `CREATE TABLE schema_migrations (
    id TEXT PRIMARY KEY,
    notion_id TEXT,
    migrated_on TEXT,
    last_modified_by TEXT NOT NULL,
    last_modified_at TEXT NOT NULL,
    version TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
);
CREATE TABLE sample (id TEXT PRIMARY KEY, extra INTEGER);
`,
  );
  await writeFile(
    path.join(dir, "002_add_extra.sql"),
    "ALTER TABLE sample ADD COLUMN extra INTEGER NOT NULL DEFAULT 0;\nCREATE TABLE sample_after (id TEXT PRIMARY KEY);\n",
  );
  const client = createClient({ url: ":memory:" });
  try {
    const ran = await migrateLibsql({ client, url: ":memory:", test: true, dir });
    assert.deepEqual(ran, ["001_sample.sql", "002_add_extra.sql"]);
    const columns = await client.execute("PRAGMA table_info(sample)");
    assert.deepEqual(
      columns.rows.map((row) => String(row.name)),
      ["id", "extra"],
    );
    const after = await client.execute("SELECT name FROM sqlite_master WHERE name = 'sample_after'");
    assert.equal(after.rows.length, 1);
  } finally {
    client.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the command applies an in-memory database only when --test is passed", () => {
  const refused = spawnSync(process.execPath, [SCRIPT], {
    cwd: WEB,
    env: { ...process.env, JOEHUB_LIBSQL_URL: ":memory:" },
    encoding: "utf8",
  });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /need --test/);

  const applied = spawnSync(process.execPath, [SCRIPT, "--test", "--url", ":memory:"], {
    cwd: WEB,
    env: { ...process.env, JOEHUB_LIBSQL_URL: "" },
    encoding: "utf8",
  });
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /001_initial\.sql/);
  assert.match(applied.stdout, /004_grocery_and_lists\.sql/);
});

test("splitter statements are complete SQLite", async () => {
  const script = await readFile(path.join(LIBSQL, "001_initial.sql"), "utf8");
  const statements = sqlStatements(script).filter((statement) => !statement.toUpperCase().startsWith("PRAGMA"));
  const check = spawnSync(
    "python3",
    ["-c", "import json,sqlite3,sys; rows=json.load(sys.stdin);\nmissing=[item for item in rows if not sqlite3.complete_statement(item)];\nprint(len(rows));\nprint('\\n'.join(missing[:3]))"],
    { input: JSON.stringify(statements), encoding: "utf8" },
  );
  assert.equal(check.status, 0, check.stderr);
  const [count, ...missing] = check.stdout.split("\n");
  assert.equal(Number(count), statements.length);
  assert.equal(missing.filter(Boolean).join("\n"), "");
});
