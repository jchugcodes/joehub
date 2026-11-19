import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";
import { writeFinanceBundle } from "../lib/finance-box.mjs";
import { createUpstashStore } from "../lib/store-upstash.mjs";
import { migrateLibsql } from "../scripts/libsql-migrate.mjs";
import { assertReadCommand, runExport } from "../scripts/finance-export.mjs";
import { runImport } from "../scripts/finance-import.mjs";
import { runTransform, transformFinanceSnapshot } from "../scripts/finance-transform.mjs";
import { runVerify } from "../scripts/finance-verify.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-19T12:20:00.000Z");
const FIXTURE = new URL("./fixtures/finance-snapshot.json", import.meta.url);
const WRITES = new Set(["SET", "DEL", "ZADD", "ZREM", "INCR", "EXPIRE", "GETDEL", "SADD", "MSET", "UNLINK", "HSET"]);

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), "joehub-finance-"));
  return {
    dir,
    file: path.join(dir, "finance.db"),
    remove() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("export reads finance documents and writes no amounts", async () => {
  const fake = await startFakeUpstash();
  const box = scratch();
  const snapshot = path.join(box.dir, "snapshot.json");
  try {
    assert.throws(() => assertReadCommand(["SET", "joehub:finance:txn:example", "{}"]), /not a read/);
    const store = createUpstashStore({ url: fake.url, token: fake.token, env: {} });
    await store.financeOverview(NOW);
    await store.financeCreateTransaction(
      { payee: "Synthetic oats", amountCents: 111, date: "2026-11-11", type: "expense", category: "groceries", sourceId: "notion:synthetic-oats" },
      NOW,
      "export-txn",
    );
    const mark = fake.commands.length;
    let printed = "";
    await assert.rejects(
      () => runExport(["--out", snapshot], { UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token }),
      /Joe's OK/,
    );
    const result = await runExport(
      ["--i-have-joes-ok", "--out", snapshot],
      { UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token },
      { stdout: (text) => (printed += text) },
    );
    const used = fake.commands.slice(mark);
    assert.ok(used.some((command) => command[0] === "SCAN"));
    assert.equal(used.some((command) => WRITES.has(command[0])), false);
    const printedCounts = printed.split("\n").filter((line) => !line.startsWith("sha256 ")).join("\n");
    assert.equal(printedCounts.includes("Synthetic"), false);
    assert.equal(printedCounts.includes("Everyday"), false);
    assert.equal(printedCounts.includes("amountCents"), false);
    assert.equal(printedCounts.includes("247236"), false);
    assert.match(printed, /transactions \d+/);
    assert.match(printed, new RegExp(`sha256 ${result.sha256}`));
    assert.equal(statSync(snapshot).mode & 0o777, 0o600);
    const saved = JSON.parse(await readFile(snapshot, "utf8"));
    assert.equal(saved.kind, "joehub-finance-snapshot");
    assert.equal(JSON.stringify(saved).includes("idem"), false);
    assert.equal(JSON.stringify(saved).includes("bysource"), false);
    assert.ok(saved.transactions.some((row) => row.id && row.body && row.body.payee === "Synthetic oats"));
  } finally {
    fake.stop();
    box.remove();
  }
});

test("a synthetic finance snapshot copies documents and refuses an unsafe import", async () => {
  const box = scratch();
  const snapshot = path.join(box.dir, "snapshot.json");
  const rowsPath = path.join(box.dir, "rows.json");
  const database = `file:${box.file}`;
  try {
    const raw = JSON.parse(await readFile(FIXTURE, "utf8"));
    const rows = transformFinanceSnapshot(raw);
    assert.equal(rows.kind, "joehub-finance-rows");
    assert.equal(rows.bundle.transactions[0].payee, "Synthetic oats");
    assert.equal(rows.bundle.transactions[0].amountCents, -111);
    assert.equal(rows.bundle.goals[0].status, "inactive");
    await writeFile(snapshot, await readFile(FIXTURE));
    let transformed = "";
    await runTransform(["--in", snapshot, "--out", rowsPath], { stdout: (text) => (transformed += text) });
    const transformedCounts = transformed.split("\n").filter((line) => !line.startsWith("sha256 ")).join("\n");
    assert.equal(transformedCounts.includes("Synthetic"), false);
    assert.equal(transformedCounts.includes("111"), false);
    assert.match(transformed, /transactions 1/);
    assert.equal(statSync(rowsPath).mode & 0o777, 0o600);

    await migrateLibsql({ url: database, test: true });
    await assert.rejects(() => runImport(["--i-have-joes-ok", "--in", rowsPath, "--url", database], {}), /need --test/);
    await assert.rejects(() => runImport(["--test", "--url", database, "--in", rowsPath], {}), /Joe's OK/);

    const seeded = createClient({ url: database });
    try {
      await writeFinanceBundle(seeded, {
        transactions: [],
        categories: raw.categories,
        caps: raw.caps,
        plan: raw.plan,
        snapshot: raw.snapshots,
        legacyAccounts: raw.legacyAccounts,
        goals: [],
        accounts: [],
        bills: [],
      });
    } finally {
      seeded.close();
    }
    await assert.rejects(
      () => runImport(["--i-have-joes-ok", "--test", "--url", database, "--in", rowsPath], {}),
      /already has finance rows/,
    );

    const fresh = `file:${path.join(box.dir, "fresh.db")}`;
    await migrateLibsql({ url: fresh, test: true });
    let imported = "";
    await runImport(["--i-have-joes-ok", "--test", "--url", fresh, "--in", rowsPath], {}, { stdout: (text) => (imported += text) });
    assert.equal(imported.includes("Synthetic"), false);
    assert.equal(imported.includes("111"), false);
    assert.match(imported, /transactions 1/);

    let verified = "";
    const passed = await runVerify(["--test", "--url", fresh, "--snapshot", snapshot], {}, { stdout: (text) => (verified += text), exitCode: false });
    assert.equal(passed.ok, true);
    assert.match(verified, /^PASS/);
    assert.equal(verified.includes("Synthetic"), false);
    assert.equal(verified.includes("111"), false);

    const client = createClient({ url: fresh });
    try {
      await client.execute({
        sql: "UPDATE finance_docs SET body = ? WHERE entity = 'transaction' AND web_id = 'fin-sample-oats'",
        args: [JSON.stringify({ id: "fin-sample-oats", payee: "Changed", amountCents: -999 })],
      });
    } finally {
      client.close();
    }
    let failed = "";
    const result = await runVerify(["--test", "--url", fresh, "--snapshot", snapshot], {}, { stdout: (text) => (failed += text), exitCode: false });
    assert.equal(result.ok, false);
    assert.match(failed, /FAIL/);
    assert.match(failed, /id fin-sample-oats/);
    assert.equal(failed.includes("Synthetic"), false);
    assert.equal(failed.includes("111"), false);
    assert.equal(failed.includes("999"), false);
    assert.equal(failed.includes("Changed"), false);
  } finally {
    box.remove();
  }
});
