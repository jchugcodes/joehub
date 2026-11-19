import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";
import { createUpstashStore } from "../lib/store-upstash.mjs";
import { migrateLibsql } from "../scripts/libsql-migrate.mjs";
import { assertReadCommand, runExport } from "../scripts/grocery-export.mjs";
import { runImport } from "../scripts/grocery-import.mjs";
import { runTransform, transformGrocerySnapshot } from "../scripts/grocery-transform.mjs";
import { formatVerifyReport, runVerify } from "../scripts/grocery-verify.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-19T12:20:00.000Z");
const FIXTURE = new URL("./fixtures/grocery-snapshot.json", import.meta.url);
const OATS = "11111111-1111-4111-8111-111111111111";
const MILK = "22222222-2222-4222-8222-222222222222";
const WRITES = new Set(["SET", "DEL", "ZADD", "ZREM", "INCR", "EXPIRE", "GETDEL", "SADD", "MSET", "UNLINK", "HSET"]);

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), "joehub-grocery-"));
  return {
    dir,
    file: path.join(dir, "grocery.db"),
    remove() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function itemCount(url) {
  const client = createClient({ url });
  try {
    const result = await client.execute("SELECT count(*) AS n FROM grocery_items");
    return Number(result.rows[0].n);
  } finally {
    client.close();
  }
}

test("export reads grocery documents and writes no item text", async () => {
  const fake = await startFakeUpstash();
  const box = scratch();
  const snapshot = path.join(box.dir, "snapshot.json");
  try {
    assert.throws(() => assertReadCommand(["SET", "joehub:grocery:item:example", "{}"]), /not a read/);
    const store = createUpstashStore({
      url: fake.url,
      token: fake.token,
      env: { VERCEL_ENV: "production" },
    });
    await store.createGrocery(
      { name: "Synthetic oats", quantity: "1 bag", section: "Pantry", notes: "Synthetic note", sourceId: "notion:synthetic-oats" },
      "export-1",
      NOW,
      "owner",
    );
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
    assert.match(printed, /items 1/);
    assert.match(printed, new RegExp(`sha256 ${result.sha256}`));
    assert.equal(statSync(snapshot).mode & 0o777, 0o600);
    const saved = JSON.parse(await readFile(snapshot, "utf8"));
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items.some((item) => String(item.id).includes("idem")), false);
    assert.equal(JSON.stringify(saved).includes("idem"), false);
  } finally {
    fake.stop();
    box.remove();
  }
});

test("a synthetic grocery snapshot copies unchecked and checked items", async () => {
  const box = scratch();
  const snapshot = path.join(box.dir, "snapshot.json");
  const rowsPath = path.join(box.dir, "rows.json");
  const database = `file:${box.file}`;
  const previousExit = process.exitCode;
  try {
    const raw = JSON.parse(await readFile(FIXTURE, "utf8"));
    const rows = transformGrocerySnapshot(raw);
    const oats = rows.items.find((row) => row.id === OATS);
    const milk = rows.items.find((row) => row.id === MILK);
    assert.equal(oats.source_id, "notion:synthetic-oats");
    assert.equal(oats.checked, 0);
    assert.equal(oats.checked_at, null);
    assert.equal(oats.body, JSON.stringify(raw.items.find((item) => item.id === OATS).body));
    assert.equal(milk.checked, 1);
    assert.equal(milk.checked_at, 1760000005000);
    assert.equal(milk.notes, "Synthetic note");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(snapshot, await readFile(FIXTURE));
    let transformed = "";
    await runTransform(["--in", snapshot, "--out", rowsPath], { stdout: (text) => (transformed += text) });
    assert.equal(transformed.includes("Synthetic"), false);
    assert.match(transformed, /items 3/);
    await migrateLibsql({ url: database, test: true });
    let imported = "";
    await runImport(["--i-have-joes-ok", "--test", "--url", database, "--in", rowsPath], {}, { stdout: (text) => (imported += text) });
    assert.equal(imported.includes("Synthetic"), false);
    assert.equal(await itemCount(database), 3);
    let verified = "";
    const passed = await runVerify(
      ["--test", "--url", database, "--snapshot", snapshot],
      {},
      { stdout: (text) => (verified += text), exitCode: false },
    );
    assert.equal(passed.ok, true);
    assert.match(verified, /^PASS\n/);
    assert.match(verified, /unchecked 2/);
    assert.match(verified, /checked 1/);
    assert.equal(verified.includes("Synthetic"), false);

    await assert.rejects(
      () => runImport(["--i-have-joes-ok", "--test", "--url", database, "--in", rowsPath], {}, { stdout: () => {} }),
      /already has grocery items/,
    );
    assert.equal(await itemCount(database), 3);
    await runImport(["--i-have-joes-ok", "--test", "--merge", "--url", database, "--in", rowsPath], {}, { stdout: () => {} });
    assert.equal(await itemCount(database), 3);

    const editor = createClient({ url: database });
    try {
      const row = await editor.execute({ sql: "SELECT body FROM grocery_items WHERE id = ?", args: [MILK] });
      const body = JSON.parse(String(row.rows[0].body));
      body.name = "Synthetic altered milk";
      await editor.execute({ sql: "UPDATE grocery_items SET body = ?, name = ? WHERE id = ?", args: [JSON.stringify(body), body.name, MILK] });
    } finally {
      editor.close();
    }
    let failed = "";
    const mismatch = await runVerify(
      ["--test", "--url", database, "--snapshot", snapshot],
      {},
      { stdout: (text) => (failed += text), exitCode: false },
    );
    assert.equal(mismatch.ok, false);
    assert.equal(failed, formatVerifyReport(mismatch));
    assert.match(failed, /^FAIL\n/);
    assert.deepEqual(mismatch.ids, [MILK]);
    assert.equal(failed.includes("Synthetic"), false);
    assert.equal(failed.includes("altered"), false);
    await runImport(["--i-have-joes-ok", "--test", "--merge", "--url", database, "--in", rowsPath], {}, { stdout: () => {} });
    const restored = await runVerify(["--test", "--url", database, "--snapshot", snapshot], {}, { stdout: () => {}, exitCode: false });
    assert.equal(restored.ok, true);
  } finally {
    process.exitCode = previousExit;
    box.remove();
  }
});

test("grocery import refuses a missing flag, a local URL, and a Turso file URL", async () => {
  const box = scratch();
  const rowsPath = path.join(box.dir, "rows.json");
  try {
    const rows = transformGrocerySnapshot(JSON.parse(await readFile(FIXTURE, "utf8")));
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
