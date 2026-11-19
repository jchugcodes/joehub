import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { readAreaBackends } from "../lib/backend.mjs";
import { boxUuid, financeScore, writeFinanceBundle } from "../lib/finance-box.mjs";
import { createRuntime } from "../lib/store.mjs";
import { createSqliteStore } from "../lib/store-sqlite.mjs";
import { createUpstashStore, StoreError } from "../lib/store-upstash.mjs";
import { migrateLibsql } from "../scripts/libsql-migrate.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-11T11:42:00.000Z");
const QUIET = { VERCEL_ENV: "production" };

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

function sampleBundle() {
  const market = {
    slug: "sample-market",
    name: "Sample market",
    weeklyCapCents: 0,
    monthlyCapCents: 500,
    sort: 1,
    color: "#111111",
    capCents: 0,
  };
  const loose = {
    slug: "sample-loose",
    name: "Sample loose",
    weeklyCapCents: null,
    monthlyCapCents: null,
    sort: 2,
    color: "#222222",
    capCents: null,
  };
  return {
    transactions: [
      {
        id: "fin-sample-oats",
        payee: "Synthetic oats",
        date: "2026-11-10",
        category: "sample-market",
        type: "expense",
        amountCents: -111,
        source: "manual",
        createdAt: 1763000000000,
        updatedAt: 1763000000000,
        accountId: "acct-sample",
      },
      {
        id: "fin-sample-loose",
        payee: "Loose sample",
        date: "2026-11-09",
        category: null,
        type: "expense",
        amountCents: -222,
        source: "manual",
        createdAt: 1763000001000,
        updatedAt: 1763000001000,
      },
    ],
    categories: [market, loose],
    fullCategories: [market, loose],
    caps: { "sample-market": 0 },
    plan: { cents: 111100 },
    snapshot: { netWorthCents: 111100, ytdDeltaCents: 111, caption: "Sample book", points: [100000, 111100] },
    legacyAccounts: {
      netWorthCents: 111100,
      assetsCents: 111100,
      liabilitiesCents: 0,
      updatedAt: "2026-11-10T00:00:00.000Z",
      accounts: [],
    },
    goals: [
      {
        slug: "sample-cabin",
        name: "Sample cabin",
        value: 0,
        amount: "$0",
        target: "$10",
        note: "",
        savedCents: 0,
        targetCents: 1000,
        status: "not_started",
        kind: "Savings",
        account: "",
        color: "#111111",
      },
      {
        slug: "sample-old",
        name: "Sample old goal",
        value: 0,
        amount: "$0",
        target: "$20",
        note: "",
        savedCents: 0,
        targetCents: 2000,
        status: "inactive",
        kind: "Savings",
        account: "",
        color: "#222222",
      },
    ],
    accounts: [
      {
        id: "acct-sample",
        name: "Sample checking",
        type: "checking",
        source: "manual",
        institution: "",
        balanceCents: 111100,
        createdAt: 1763000000000,
        updatedAt: 1763000000000,
        hiddenFromNetWorth: false,
        closed: false,
      },
    ],
    bills: [
      {
        id: "bill-sample",
        name: "Sample power",
        amountCents: 111,
        dueDate: "2026-11-20",
        recurrence: "monthly",
        category: "sample-market",
        accountId: "acct-sample",
        paid: false,
        paidOn: null,
        createdAt: 1763000000000,
        updatedAt: 1763000000000,
        sort: 1,
      },
    ],
  };
}

async function command(fake, args) {
  const response = await fetch(fake.url, {
    method: "POST",
    headers: { authorization: `Bearer ${fake.token}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`fake ${response.status}`);
}

async function prime(fake, bundle) {
  const key = "joehub:finance";
  await command(fake, ["SET", `${key}:seeded`, "1"]);
  await command(fake, ["SET", `${key}:seeded:v2`, "1"]);
  await command(fake, ["SET", `${key}:seeded:v3`, "1"]);
  await command(fake, ["SET", `${key}:seeded:v4`, "1"]);
  await command(fake, ["SET", `${key}:caps`, JSON.stringify(bundle.caps)]);
  await command(fake, ["SET", `${key}:categories`, JSON.stringify(bundle.categories)]);
  await command(fake, ["SET", `${key}:plan`, JSON.stringify(bundle.plan)]);
  await command(fake, ["SET", `${key}:snapshots`, JSON.stringify(bundle.snapshot)]);
  await command(fake, ["SET", `${key}:accounts`, JSON.stringify(bundle.legacyAccounts)]);
  await command(fake, ["SET", `${key}:goals`, JSON.stringify(bundle.goals)]);
  for (const row of bundle.transactions) {
    await command(fake, ["SET", `${key}:txn:${row.id}`, JSON.stringify(row)]);
    await command(fake, ["ZADD", `${key}:txns`, String(financeScore(row)), row.id]);
  }
  for (const account of bundle.accounts) {
    await command(fake, ["SET", `${key}:account:${account.id}`, JSON.stringify(account)]);
    await command(fake, ["ZADD", `${key}:accounts:index`, String(account.createdAt || 0), account.id]);
  }
  for (const bill of bundle.bills) {
    await command(fake, ["SET", `${key}:bill:${bill.id}`, JSON.stringify(bill)]);
    await command(fake, ["ZADD", `${key}:bills:index`, String(bill.createdAt || 0), bill.id]);
  }
}

async function reads(store) {
  return {
    overview: await store.financeOverview(NOW),
    overviewWeek: await store.financeOverview(NOW, "2026-11-09", "week"),
    month: await store.financeSpendingMonth(NOW),
    badMonth: await store.financeSpendingMonth(NOW, "2026-13"),
    categories: await store.financeCategories(NOW, "month"),
    categoriesWeek: await store.financeCategories(NOW, "week"),
    category: await store.financeCategory(NOW, "", "groceries", "week"),
    categoryMonth: await store.financeCategory(NOW, "", "groceries", "month"),
    missingCategory: await store.financeCategory(NOW, "", "missing-sample", "week"),
    bills: await store.financeBills(NOW),
    bill: await store.financeBill("bill-water", NOW),
    missingBill: await store.financeBill("bill-missing", NOW),
    goals: await store.financeGoals(),
    accounts: await store.financeAccounts(NOW),
    account: await store.financeAccount("acct-checking", NOW),
    missingAccount: await store.financeAccount("acct-missing", NOW),
    debts: await store.financeDebts(NOW),
    debt: await store.financeDebt("acct-student-01", NOW),
    missingDebt: await store.financeDebt("acct-missing", NOW),
    transactions: await store.financeTransactions(NOW),
    accountTransactions: await store.financeTransactions(NOW, "", "acct-checking"),
    badAccount: await store.financeTransactions(NOW, "", "acct-nope"),
    transaction: await store.financeTransaction("fin-sweetgreen"),
    missingTransaction: await store.financeTransaction("missing"),
  };
}

test("finance flag defaults to upstash and does not follow the Turso URL", () => {
  assert.deepEqual(readAreaBackends({}), { tasks: "upstash", grocery: "upstash", finance: "upstash" });
  assert.deepEqual(readAreaBackends({ JOEHUB_BACKEND_FINANCE: "sqlite" }), { tasks: "upstash", grocery: "upstash", finance: "sqlite" });
  assert.deepEqual(readAreaBackends({ TURSO_DATABASE_URL: "libsql://turso.example", TURSO_AUTH_TOKEN: "token" }), {
    tasks: "upstash",
    grocery: "upstash",
    finance: "upstash",
  });
  assert.throws(() => readAreaBackends({ JOEHUB_BACKEND_FINANCE: "postgres" }), /unknown JOEHUB_BACKEND_FINANCE/);
  assert.throws(() => createRuntime({ JOEHUB_BACKEND_FINANCE: "sqlite" }), /libSQL URL is missing/);
});

test("seeded finance reads match across sqlite and upstash", async () => {
  const fake = await startFakeUpstash();
  const client = await openDb();
  try {
    const upstash = createUpstashStore({ url: fake.url, token: fake.token, env: {} });
    const sqlite = createSqliteStore({ client, env: {} });
    assert.deepEqual(await reads(sqlite), await reads(upstash));
    const names = (await sqlite.financeAccounts(NOW)).accounts.map((account) => account.name);
    assert.equal(names.includes("Unassigned"), false);
  } finally {
    client.close();
    fake.stop();
  }
});

test("an empty production finance database rejects reads", async () => {
  const fake = await startFakeUpstash();
  const client = await openDb();
  try {
    const upstash = createUpstashStore({ url: fake.url, token: fake.token, env: QUIET });
    const sqlite = createSqliteStore({ client, env: QUIET });
    await assert.rejects(() => sqlite.financeGoals(), StoreError);
    await assert.rejects(() => upstash.financeGoals(), StoreError);
    await assert.rejects(() => sqlite.financeSaveCaps({ caps: {} }, "k"), StoreError);
  } finally {
    client.close();
    fake.stop();
  }
});

test("sqlite mode maps caps, unassigned transactions, and goal statuses", async () => {
  const client = await openDb();
  try {
    const sqlite = createSqliteStore({ client, env: {} });
    await sqlite.financeGoals();
    assert.equal(await cell(client, "SELECT DISTINCT kind FROM categories"), "expense");
    assert.equal(Number(await cell(client, "SELECT COUNT(*) AS n FROM categories WHERE kind != 'expense'")), 0);
    assert.equal(
      Number(await cell(client, "SELECT amount_cents FROM budgets b JOIN finance_ids i ON i.box_id = b.id AND i.entity = 'budget' WHERE i.web_id = 'utilities:weekly'")),
      0,
    );
    assert.equal(
      Number(await cell(client, "SELECT COUNT(*) AS n FROM finance_ids WHERE entity = 'budget' AND web_id = 'health-fitness:weekly'")),
      0,
    );
    assert.equal(
      Number(await cell(client, "SELECT COUNT(*) AS n FROM finance_ids WHERE entity = 'budget' AND web_id IN ('groceries:weekly', 'groceries:monthly')")),
      2,
    );
    assert.equal(
      await cell(
        client,
        `SELECT a.name FROM transactions t
         JOIN finance_ids i ON i.box_id = t.id AND i.entity = 'transaction'
         JOIN accounts a ON a.id = t.account_id
         WHERE i.web_id = 'fin-sweetgreen'`,
      ),
      "Unassigned",
    );
    assert.equal(Number(await cell(client, "SELECT COUNT(*) AS n FROM accounts WHERE name = 'Unassigned'")), 1);
    assert.equal(await cell(client, "SELECT body FROM finance_docs WHERE entity = 'account' AND web_id = 'acct-unassigned'"), undefined);
    const sweetDoc = JSON.parse(await cell(client, "SELECT body FROM finance_docs WHERE entity = 'transaction' AND web_id = 'fin-sweetgreen'"));
    assert.equal(Object.prototype.hasOwnProperty.call(sweetDoc, "accountId"), false);
    assert.equal((await sqlite.financeTransaction("fin-sweetgreen")).body.accountId, null);
    assert.equal(
      await cell(
        client,
        `SELECT g.status FROM goals g
         JOIN finance_ids i ON i.box_id = g.id AND i.entity = 'goal'
         WHERE i.web_id = 'travel-japan'`,
      ),
      "paused",
    );
    assert.equal(
      await cell(
        client,
        `SELECT a.name FROM goals g
         JOIN finance_ids i ON i.box_id = g.id AND i.entity = 'goal'
         JOIN accounts a ON a.id = g.account_id
         WHERE i.web_id = 'emergency-fund'`,
      ),
      "Emergency savings",
    );
    assert.equal(Number(await cell(client, "SELECT COUNT(*) AS n FROM categories WHERE notion_id IS NOT NULL")), 0);
    assert.equal(Number(await cell(client, "SELECT COUNT(*) AS n FROM finance_ids WHERE entity = 'bill' AND web_id = 'bill-water'")), 1);
  } finally {
    client.close();
  }
});

test("the same custom book matches, including not_started and inactive", async () => {
  const bundle = sampleBundle();
  const fake = await startFakeUpstash();
  const client = await openDb();
  try {
    await prime(fake, bundle);
    await writeFinanceBundle({ execute: (query) => client.execute(query) }, bundle);
    const upstash = createUpstashStore({ url: fake.url, token: fake.token, env: QUIET });
    const sqlite = createSqliteStore({ client, env: QUIET });
    assert.deepEqual(await sqlite.financeGoals(), bundle.goals);
    assert.deepEqual(await sqlite.financeGoals(), await upstash.financeGoals());
    assert.deepEqual(await sqlite.financeOverview(NOW), await upstash.financeOverview(NOW));
    assert.deepEqual(await sqlite.financeSpendingMonth(NOW), await upstash.financeSpendingMonth(NOW));
    assert.deepEqual(await sqlite.financeCategories(NOW, "week"), await upstash.financeCategories(NOW, "week"));
    assert.deepEqual(await sqlite.financeBills(NOW), await upstash.financeBills(NOW));
    assert.deepEqual(await sqlite.financeAccounts(NOW), await upstash.financeAccounts(NOW));
    assert.deepEqual(await sqlite.financeDebts(NOW), await upstash.financeDebts(NOW));
    assert.deepEqual(await sqlite.financeTransactions(NOW), await upstash.financeTransactions(NOW));
    assert.deepEqual(await sqlite.financeTransaction("fin-sample-loose"), await upstash.financeTransaction("fin-sample-loose"));
    const looseDoc = JSON.parse(await cell(client, "SELECT body FROM finance_docs WHERE entity = 'transaction' AND web_id = 'fin-sample-loose'"));
    assert.equal(Object.prototype.hasOwnProperty.call(looseDoc, "accountId"), false);
    assert.equal((await sqlite.financeTransaction("fin-sample-loose")).body.accountId, null);
    assert.equal(
      await cell(
        client,
        `SELECT g.status || ' ' || s.status FROM goals g
         JOIN finance_ids i ON i.box_id = g.id AND i.entity = 'goal'
         JOIN finance_goal_status s ON s.box_id = g.id
         WHERE i.web_id = 'sample-cabin'`,
      ),
      "active not_started",
    );
    assert.equal(
      await cell(
        client,
        `SELECT g.status || ' ' || s.status FROM goals g
         JOIN finance_ids i ON i.box_id = g.id AND i.entity = 'goal'
         JOIN finance_goal_status s ON s.box_id = g.id
         WHERE i.web_id = 'sample-old'`,
      ),
      "paused inactive",
    );
    assert.equal(
      await cell(
        client,
        `SELECT a.id FROM transactions t
         JOIN finance_ids i ON i.box_id = t.id AND i.entity = 'transaction'
         JOIN accounts a ON a.id = t.account_id
         WHERE i.web_id = 'fin-sample-loose'`,
      ),
      boxUuid("account", "acct-unassigned"),
    );
    assert.equal(Number(await cell(client, "SELECT amount_cents FROM budgets b JOIN finance_ids i ON i.box_id = b.id WHERE i.web_id = 'sample-market:weekly'")), 0);
    assert.equal(Number(await cell(client, "SELECT COUNT(*) AS n FROM finance_ids WHERE web_id = 'sample-loose:weekly'")), 0);
  } finally {
    client.close();
    fake.stop();
  }
});

test("finance sqlite reads and writes miss redis", async () => {
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
    await writeFinanceBundle({ execute: (query) => client.execute(query) }, sampleBundle());
    const mark = fake.commands.length;
    await runtime.store.financeOverview(NOW);
    await runtime.store.financeCategory(NOW, "", "sample-market", "week");
    await runtime.store.financeCategories(NOW, "month");
    await runtime.store.financeSpendingMonth(NOW);
    await runtime.store.financeAccounts(NOW);
    await runtime.store.financeAccount("acct-sample", NOW);
    await runtime.store.financeDebts(NOW);
    await runtime.store.financeDebt("acct-sample", NOW);
    await runtime.store.financeBills(NOW);
    await runtime.store.financeBill("bill-sample", NOW);
    await runtime.store.financeGoals();
    await runtime.store.financeTransactions(NOW);
    await runtime.store.financeTransaction("fin-sample-oats");
    assert.equal(financeHit(fake.commands.slice(mark)), false);
    const saved = await runtime.store.financeSaveCaps({ caps: { "sample-market": 0 } }, "sample-key");
    assert.equal(saved.status, 200);
    const replay = await runtime.store.financeSaveCaps({ caps: {} }, "sample-key");
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, saved.body);
    const created = await runtime.store.financeCreateGoal(
      { name: "Sample jar goal", savedCents: 100, targetCents: 1000, kind: "Savings" },
      "sample-goal",
    );
    assert.equal(created.status, 201);
    assert.equal(financeHit(fake.commands.slice(mark)), false);
    assert.equal(Number(await cell(client, "SELECT COUNT(*) AS n FROM tasks")), 0);
    assert.equal(Number(await cell(client, "SELECT COUNT(*) AS n FROM grocery_items")), 0);
  } finally {
    client.close();
    fake.stop();
  }
});

test("a tasks sqlite flag leaves finance reads on redis", async () => {
  const fake = await startFakeUpstash();
  const client = await openDb();
  try {
    const runtime = createRuntime(
      {
        ...QUIET,
        UPSTASH_REDIS_REST_URL: fake.url,
        UPSTASH_REDIS_REST_TOKEN: fake.token,
        JOEHUB_BACKEND_TASKS: "sqlite",
        JOEHUB_LIBSQL_URL: "libsql://example.turso.io",
      },
      { tasksClient: client },
    );
    const mark = fake.commands.length;
    await assert.rejects(() => runtime.store.financeOverview(NOW), StoreError);
    assert.equal(financeHit(fake.commands.slice(mark)), true);
    assert.equal(Number(await cell(client, "SELECT COUNT(*) AS n FROM categories")), 0);
    assert.equal(Number(await cell(client, "SELECT COUNT(*) AS n FROM finance_docs")), 0);
  } finally {
    client.close();
    fake.stop();
  }
});
