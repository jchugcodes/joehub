import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { defaultCaps } from "../lib/finance.mjs";
import { createRuntime } from "../lib/store.mjs";
import { createUpstashStore, StoreError } from "../lib/store-upstash.mjs";
import { migrateLibsql } from "../scripts/libsql-migrate.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-11T11:42:00.000Z");
const SEEDED = { NODE_ENV: "production" };
const QUIET = { VERCEL_ENV: "production" };
const BUDGET_SLUGS = ["dining-out", "groceries", "transport", "subscriptions", "shopping", "utilities", "health-fitness", "fun", "school", "other"];
const GOAL_STATUSES = ["active", "not_started", "paused", "inactive"];

function financeHit(commands) {
  return commands.some((command) => command.some((part) => typeof part === "string" && part.includes("joehub:finance")));
}

async function openDb() {
  const client = createClient({ url: ":memory:" });
  await migrateLibsql({ client, url: ":memory:", test: true });
  return client;
}

async function cell(client, sql, args = []) {
  const result = await client.execute({ sql, args });
  const row = result.rows[0];
  if (!row) return undefined;
  return row[Object.keys(row)[0]];
}

function budgets() {
  return Object.fromEntries(BUDGET_SLUGS.map((slug) => [slug, slug === "groceries" ? 11100 : null]));
}

function caps() {
  const next = { ...defaultCaps() };
  next.groceries += 100;
  next["dining-out"] -= 100;
  return next;
}

async function writeSequence(store) {
  const savedCaps = await store.financeSaveCaps({ caps: caps() }, "caps-1");
  const replayCaps = await store.financeSaveCaps({ caps: {} }, "caps-1");
  const savedBudgets = await store.financeSaveBudgets({ budgets: budgets() }, "budgets-1");
  const account = await store.financeCreateAccount({ name: "Sample jar", type: "cash", balanceCents: 11100 }, NOW, "acct-1");
  const patchedAccount = await store.financePatchAccount(account.body.id, { name: "Sample jar", type: "cash", balanceCents: 22200 }, NOW);
  const empty = await store.financeCreateAccount({ name: "Sample empty", type: "cash", balanceCents: 100 }, NOW, "acct-empty");
  const removedAccount = await store.financeDeleteAccount(empty.body.id);
  const loan = await store.financePatchAccount("acct-student-01", { hiddenFromNetWorth: true }, NOW);
  const bill = await store.financeCreateBill(
    { name: "Synthetic power", amountCents: 111, dueDate: "2026-11-20", recurrence: "monthly", accountId: "acct-cash", category: "utilities" },
    NOW,
    "bill-1",
  );
  const paid = await store.financePatchBill(bill.body.id, { paid: true }, NOW);
  const extraBill = await store.financeCreateBill(
    { name: "Synthetic spare", amountCents: 222, dueDate: "2026-11-21", recurrence: "weekly", accountId: "acct-cash", category: "utilities" },
    NOW,
    "bill-2",
  );
  const removedBill = await store.financeDeleteBill(extraBill.body.id);
  const goals = {};
  for (const status of GOAL_STATUSES) {
    const created = await store.financeCreateGoal(
      { name: `Sample ${status}`, savedCents: 100, targetCents: 1000, kind: "Savings" },
      `goal-${status}`,
    );
    goals[status] = await store.financePatchGoal(created.body.slug, { status });
  }
  const dropped = await store.financeCreateGoal({ name: "Sample dropped", savedCents: 100, targetCents: 1000, kind: "Savings" }, "goal-drop");
  const removedGoal = await store.financeDeleteGoal(dropped.body.slug);
  const txn = await store.financeCreateTransaction(
    { payee: "Synthetic oats", amountCents: 111, date: "2026-11-11", type: "expense", category: "groceries", accountId: account.body.id },
    NOW,
    "txn-1",
  );
  const replayTxn = await store.financeCreateTransaction(
    { payee: "Synthetic oats", amountCents: 999, date: "2026-11-11", type: "expense", category: "groceries" },
    NOW,
    "txn-1",
  );
  const sourced = await store.financeCreateTransaction(
    {
      payee: "Synthetic oats",
      amountCents: 111,
      date: "2026-11-11",
      type: "expense",
      category: "groceries",
      sourceId: "notion:synthetic-oats",
      accountId: account.body.id,
    },
    NOW,
    "txn-src",
  );
  const sourcedAgain = await store.financeCreateTransaction(
    {
      payee: "Synthetic oats renamed",
      amountCents: 222,
      date: "2026-11-11",
      type: "expense",
      category: "groceries",
      sourceId: "notion:synthetic-oats",
      accountId: account.body.id,
    },
    NOW,
    "txn-src-2",
  );
  const loose = await store.financeCreateTransaction(
    { payee: "Synthetic loose", amountCents: 111, date: "2026-11-10", type: "expense", category: "groceries" },
    NOW,
    "txn-loose",
  );
  const imported = await store.financeImportTransaction({
    id: "fin-synthetic-import",
    payee: "Synthetic import",
    amountCents: -111,
    date: "2026-11-09",
    type: "expense",
    category: "groceries",
    sourceId: "notion:synthetic-import",
  });
  const refreshed = await store.financeSimulateRefresh(NOW);
  const reset = await store.financeResetLedger("fin-missing");
  const blank = await store.financeCreateGoal({ name: "" }, "goal-blank");
  const missing = await store.financePatchGoal("missing-goal", { status: "active" });
  const reads = {
    overview: await store.financeOverview(NOW),
    spending: await store.financeSpendingMonth(NOW),
    categories: await store.financeCategories(NOW, "month"),
    week: await store.financeCategories(NOW, "week"),
    bills: await store.financeBills(NOW),
    goals: await store.financeGoals(),
    accounts: await store.financeAccounts(NOW),
    debts: await store.financeDebts(NOW),
    debt: await store.financeDebt("acct-student-01", NOW),
    transactions: await store.financeTransactions(NOW),
    transaction: await store.financeTransaction(txn.body.id),
    loose: await store.financeTransaction(loose.body.id),
    account: await store.financeAccount(account.body.id, NOW),
  };
  return {
    savedCaps,
    replayCaps,
    savedBudgets,
    account,
    patchedAccount,
    removedAccount,
    loan,
    bill,
    paid,
    removedBill,
    goals,
    removedGoal,
    txn,
    replayTxn,
    sourced,
    sourcedAgain,
    loose,
    imported,
    refreshed,
    reset,
    blank,
    missing,
    reads,
  };
}

test("the same finance write sequence reads the same JSON from both stores", async () => {
  const fake = await startFakeUpstash();
  const client = await openDb();
  try {
    const upstash = createUpstashStore({ url: fake.url, token: fake.token, env: SEEDED });
    const sqlite = createRuntime(
      { ...SEEDED, UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token, JOEHUB_BACKEND_FINANCE: "sqlite", JOEHUB_LIBSQL_URL: "libsql://example.turso.io" },
      { financeClient: client },
    ).store;
    await upstash.financeOverview(NOW);
    await sqlite.financeOverview(NOW);
    const left = await writeSequence(upstash);
    const right = await writeSequence(sqlite);
    assert.deepEqual(right, left);
    assert.equal(right.replayCaps.status, 200);
    assert.deepEqual(right.replayCaps.body, right.savedCaps.body);
    assert.equal(right.replayTxn.body.id, right.txn.body.id);
    assert.equal(right.sourcedAgain.body.id, right.sourced.body.id);
    assert.equal(right.sourcedAgain.body.payee, "Synthetic oats renamed");
    assert.equal(right.loose.body.accountId, null);
    assert.equal(right.blank.status, 400);
    assert.equal(right.missing.status, 404);
    assert.equal(right.removedAccount.status, 200);
    assert.equal(right.loan.status, 200);
    const source = await cell(client, "SELECT web_id FROM finance_sources WHERE source_id = 'notion:synthetic-oats'");
    assert.equal(source, right.sourced.body.id);
    const idem = await cell(client, "SELECT COUNT(*) AS n FROM finance_idem");
    assert.ok(Number(idem) > 0);
  } finally {
    client.close();
    fake.stop();
  }
});

test("an inactive goal is paused in goals.status and the exact status stays beside it", async () => {
  const fake = await startFakeUpstash();
  const client = await openDb();
  try {
    const upstash = createUpstashStore({ url: fake.url, token: fake.token, env: SEEDED });
    const sqlite = createRuntime(
      { ...SEEDED, UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token, JOEHUB_BACKEND_FINANCE: "sqlite", JOEHUB_LIBSQL_URL: "libsql://example.turso.io" },
      { financeClient: client },
    ).store;
    await upstash.financeGoals();
    await sqlite.financeGoals();
    const slugs = {};
    for (const status of GOAL_STATUSES) {
      const created = await sqlite.financeCreateGoal(
        { name: `Status ${status}`, savedCents: 100, targetCents: 1000, kind: "Savings" },
        `status-${status}`,
      );
      await upstash.financeCreateGoal(
        { name: `Status ${status}`, savedCents: 100, targetCents: 1000, kind: "Savings" },
        `status-${status}`,
      );
      slugs[status] = created.body.slug;
      assert.equal((await sqlite.financePatchGoal(created.body.slug, { status })).status, 200);
      assert.equal((await upstash.financePatchGoal(created.body.slug, { status })).status, 200);
    }
    const expectedBox = { active: "active", not_started: "active", paused: "paused", inactive: "paused" };
    for (const status of GOAL_STATUSES) {
      const box = await cell(
        client,
        `SELECT g.status FROM goals g
         JOIN finance_ids i ON i.box_id = g.id AND i.entity = 'goal'
         WHERE i.web_id = ?`,
        [slugs[status]],
      );
      const exact = await cell(
        client,
        `SELECT s.status FROM finance_goal_status s
         JOIN finance_ids i ON i.box_id = s.box_id AND i.entity = 'goal'
         WHERE i.web_id = ?`,
        [slugs[status]],
      );
      assert.equal(box, expectedBox[status], status);
      assert.equal(exact, status);
    }
    const fromSqlite = await sqlite.financeGoals();
    const fromUpstash = await upstash.financeGoals();
    assert.deepEqual(fromSqlite, fromUpstash);
    for (const status of GOAL_STATUSES) {
      assert.equal(fromSqlite.find((goal) => goal.slug === slugs[status]).status, status);
    }
  } finally {
    client.close();
    fake.stop();
  }
});

test("sqlite finance mode does not read or write a finance redis key", async () => {
  const fake = await startFakeUpstash();
  const client = await openDb();
  try {
    const runtime = createRuntime(
      {
        ...SEEDED,
        UPSTASH_REDIS_REST_URL: fake.url,
        UPSTASH_REDIS_REST_TOKEN: fake.token,
        JOEHUB_BACKEND_FINANCE: "sqlite",
        JOEHUB_LIBSQL_URL: "libsql://example.turso.io",
      },
      { financeClient: client },
    );
    const mark = fake.commands.length;
    const store = runtime.store;
    await store.financeOverview(NOW);
    await store.financeCategory(NOW, "", "groceries", "week");
    await store.financeCategories(NOW, "month");
    await store.financeSpendingMonth(NOW);
    await store.financeAccounts(NOW);
    await store.financeAccount("acct-cash", NOW);
    await store.financeDebts(NOW);
    await store.financeDebt("acct-student-01", NOW);
    await store.financeBills(NOW);
    await store.financeGoals();
    await store.financeTransactions(NOW);
    await store.financeRows();
    await store.financeBundle();
    await store.financeSaveCaps({ caps: caps() }, "iso-caps");
    await store.financeSaveCaps({ caps: {} }, "iso-caps");
    await store.financeSaveBudgets({ budgets: budgets() }, "iso-budgets");
    const account = await store.financeCreateAccount({ name: "Sample jar", type: "cash", balanceCents: 11100 }, NOW, "iso-acct");
    await store.financePatchAccount(account.body.id, { name: "Sample jar", type: "cash", balanceCents: 22200 }, NOW);
    await store.financeDeleteAccount("acct-missing");
    const bill = await store.financeCreateBill(
      { name: "Synthetic power", amountCents: 111, dueDate: "2026-11-20", recurrence: "monthly", accountId: "acct-cash", category: "utilities" },
      NOW,
      "iso-bill",
    );
    await store.financePatchBill(bill.body.id, { paid: true }, NOW);
    await store.financeDeleteBill(bill.body.id);
    const goal = await store.financeCreateGoal({ name: "Sample inactive", savedCents: 100, targetCents: 1000, kind: "Savings" }, "iso-goal");
    await store.financePatchGoal(goal.body.slug, { status: "inactive" });
    await store.financeDeleteGoal(goal.body.slug);
    const txn = await store.financeCreateTransaction(
      { payee: "Synthetic oats", amountCents: 111, date: "2026-11-11", type: "expense", category: "groceries", sourceId: "notion:synthetic-oats" },
      NOW,
      "iso-txn",
    );
    await store.financeCreateTransaction(
      { payee: "Synthetic oats renamed", amountCents: 222, date: "2026-11-11", type: "expense", category: "groceries", sourceId: "notion:synthetic-oats" },
      NOW,
      "iso-txn-2",
    );
    await store.financePatchTransaction(txn.body.id, { payee: "Synthetic oats renamed", amountCents: 222, date: "2026-11-11", type: "expense", category: "groceries" }, NOW);
    await store.financeImportTransaction({
      id: "fin-synthetic-import",
      payee: "Synthetic import",
      amountCents: -111,
      date: "2026-11-09",
      type: "expense",
      category: "groceries",
      sourceId: "notion:synthetic-import",
    });
    await store.financeSimulateRefresh(NOW);
    await store.financeResetLedger("not a id");
    await store.financeTransaction(txn.body.id);
    assert.equal(financeHit(fake.commands.slice(mark)), false);
    assert.equal(Number(await cell(client, "SELECT COUNT(*) AS n FROM tasks")), 0);
    assert.equal(Number(await cell(client, "SELECT COUNT(*) AS n FROM grocery_items")), 0);
  } finally {
    client.close();
    fake.stop();
  }
});

test("an empty production finance database rejects writes", async () => {
  const fake = await startFakeUpstash();
  const client = await openDb();
  try {
    const runtime = createRuntime(
      {
        ...QUIET,
        UPSTASH_REDIS_REST_URL: fake.url,
        UPSTASH_REDIS_REST_TOKEN: fake.token,
        JOEHUB_BACKEND_FINANCE: "sqlite",
        JOEHUB_LIBSQL_URL: "libsql://example.turso.io",
      },
      { financeClient: client },
    );
    const mark = fake.commands.length;
    await assert.rejects(() => runtime.store.financeSaveCaps({ caps: {} }, "k"), StoreError);
    await assert.rejects(() => runtime.store.financeCreateTransaction({ payee: "Synthetic oats" }, NOW, "k"), StoreError);
    assert.equal(financeHit(fake.commands.slice(mark)), false);
  } finally {
    client.close();
    fake.stop();
  }
});
