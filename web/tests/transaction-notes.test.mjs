import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { cleanTags, installMemoryFinance, patchTransaction, SEED_TRANSACTIONS } from "../lib/finance.mjs";
import { createRuntime } from "../lib/store.mjs";
import { migrateLibsql } from "../scripts/libsql-migrate.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-11T11:42:00.000Z");

test("tags trim, drop a leading #, and collapse case-insensitive duplicates", () => {
  assert.deepEqual(cleanTags(" trip, #Work ,trip,  , work, Sample  gift "), { ok: true, tags: ["trip", "Work", "Sample gift"] });
  assert.deepEqual(cleanTags(["a", "b"]), { ok: true, tags: ["a", "b"] });
  assert.equal(cleanTags("x".repeat(31)).field, "tags");
  assert.equal(cleanTags(Array.from({ length: 11 }, (_, i) => `t${i}`)).field, "tags");
  assert.equal(cleanTags([1]).ok, false);
  assert.equal(cleanTags(7).ok, false);
});

test("a note or tags on a Ledger row is not a correction", () => {
  const result = patchTransaction(SEED_TRANSACTIONS, "fin-payroll", { note: "  Sample road trip \r\n fuel  ", tags: "trip, car" }, NOW);
  assert.equal(result.status, 200);
  assert.equal(result.body.corrected, false);
  assert.equal(result.body.correction, null);
  assert.equal(result.body.note, "Sample road trip \n fuel");
  assert.deepEqual(result.body.tags, ["trip", "car"]);
  const row = result.rows.find((item) => item.id === "fin-payroll");
  assert.equal(row.correction, undefined);
  const before = SEED_TRANSACTIONS.find((item) => item.id === "fin-payroll");
  assert.equal(row.amountCents, before.amountCents);
  assert.equal(row.payee, before.payee);
});

test("a note on a corrected Ledger row leaves the correction as it was", () => {
  const before = SEED_TRANSACTIONS.find((item) => item.id === "fin-shell");
  assert.ok(before.correction);
  const result = patchTransaction(SEED_TRANSACTIONS, "fin-shell", { note: "Sample note" }, NOW);
  const row = result.rows.find((item) => item.id === "fin-shell");
  assert.deepEqual(row.correction, before.correction);
  assert.equal(result.body.note, "Sample note");
});

test("rename and note together on a manual row, and an empty note clears it", () => {
  const named = patchTransaction(SEED_TRANSACTIONS, "fin-pizza", { payee: "  Sample   pizza night ", note: "Split with a friend", tags: ["food"] }, NOW);
  assert.equal(named.status, 200);
  assert.equal(named.body.payee, "Sample pizza night");
  assert.equal(named.body.note, "Split with a friend");
  const cleared = patchTransaction(named.rows, "fin-pizza", { note: "", tags: [] }, NOW);
  assert.equal(cleared.body.note, null);
  assert.deepEqual(cleared.body.tags, []);
  const row = cleared.rows.find((item) => item.id === "fin-pizza");
  assert.equal("note" in row, false);
  assert.equal("tags" in row, false);
  assert.equal(row.payee, "Sample pizza night");
});

test("other edits keep the note and tags", () => {
  const noted = patchTransaction(SEED_TRANSACTIONS, "fin-pizza", { note: "Keep me", tags: "food" }, NOW);
  const moved = patchTransaction(noted.rows, "fin-pizza", { type: "expense", category: "groceries" }, NOW);
  assert.equal(moved.body.category, "groceries");
  assert.equal(moved.body.note, "Keep me");
  assert.deepEqual(moved.body.tags, ["food"]);
});

test("a failed save changes nothing", () => {
  const long = patchTransaction(SEED_TRANSACTIONS, "fin-pizza", { note: "x".repeat(501) }, NOW);
  assert.equal(long.status, 400);
  assert.equal(long.body.field, "note");
  assert.equal(long.rows, SEED_TRANSACTIONS);
  const badTags = patchTransaction(SEED_TRANSACTIONS, "fin-pizza", { note: "fine", tags: "y".repeat(40) }, NOW);
  assert.equal(badTags.status, 400);
  assert.equal(badTags.body.field, "tags");
  assert.equal(badTags.rows, SEED_TRANSACTIONS);
  assert.equal(patchTransaction(SEED_TRANSACTIONS, "fin-pizza", { note: 5 }, NOW).body.field, "note");
});

test("the memory store keeps a note and tags after a reload", async () => {
  const store = installMemoryFinance({});
  const saved = await store.financePatchTransaction("fin-shell", { note: "Sample note", tags: ["trip"] }, NOW);
  assert.equal(saved.status, 200);
  const read = await store.financeTransaction("fin-shell");
  assert.equal(read.body.note, "Sample note");
  assert.deepEqual(read.body.tags, ["trip"]);
});

async function notesOn(store) {
  await store.financeSpendingMonth(NOW);
  const saved = await store.financePatchTransaction("fin-payroll", { note: "Sample road trip", tags: "trip, car" }, NOW);
  const rejected = await store.financePatchTransaction("fin-payroll", { note: "z".repeat(600) }, NOW);
  const read = await store.financeTransaction("fin-payroll");
  const week = await store.financeTransactions(NOW, "2026-11-09");
  const listed = week.body.rows.find((row) => row.id === "fin-payroll");
  return {
    status: saved.status,
    rejected: rejected.status,
    note: read.body.note,
    tags: read.body.tags,
    corrected: read.body.corrected,
    listed: { note: listed.note, tags: listed.tags },
  };
}

test("a note and tags hold on upstash and libsql, and libsql writes the note to memo", async () => {
  const fake = await startFakeUpstash();
  const client = createClient({ url: ":memory:" });
  await migrateLibsql({ client, url: ":memory:", test: true });
  const env = { NODE_ENV: "production" };
  const upstash = createRuntime({ ...env, UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token });
  const sqlite = createRuntime(
    { ...env, JOEHUB_BACKEND_FINANCE: "sqlite", JOEHUB_LIBSQL_URL: "libsql://example.turso.io" },
    { financeClient: client },
  );
  try {
    const left = await notesOn(upstash.store);
    const right = await notesOn(sqlite.store);
    assert.deepEqual(right, left);
    assert.deepEqual(left, {
      status: 200,
      rejected: 400,
      note: "Sample road trip",
      tags: ["trip", "car"],
      corrected: false,
      listed: { note: "Sample road trip", tags: ["trip", "car"] },
    });
    const memo = await client.execute("SELECT COUNT(*) AS n FROM transactions WHERE memo = 'Sample road trip'");
    assert.equal(Number(memo.rows[0].n), 1);
  } finally {
    fake.stop();
    client.close();
  }
});
