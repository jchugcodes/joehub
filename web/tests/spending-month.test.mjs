import assert from "node:assert/strict";
import test from "node:test";
import { handleFinanceSpendingMonth } from "../lib/api.mjs";
import { SEED_TRANSACTIONS, categoriesSnapshot, countsAsSpend, defaultCaps, installMemoryFinance, overview, spendingMonth, spendCents, transactionsForWeek } from "../lib/finance.mjs";
import { showMonthBudget } from "../lib/live-pages.mjs";
import { createStore, login } from "../lib/sessions.mjs";
import { createUpstashStore } from "../lib/store-upstash.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-11T15:00:00-05:00");
const MONTH = "2026-11";

function oldClientMonth(txns, now, caps, categories, saved, planCents, env) {
  const snapshot = categoriesSnapshot(txns, now, "month", caps, categories, saved);
  const month = overview(txns, now, "", "YTD", caps, {
    planCents: planCents ?? undefined,
    categories,
    budgetsSaved: saved,
    env,
  }).body.month;
  const pages = [];
  let week = "";
  for (let step = 0; step < 8; step += 1) {
    const page = transactionsForWeek(txns, now, week, "");
    if (page.status !== 200) break;
    pages.push(page.body);
    const monthStart = `${page.body.today.slice(0, 7)}-01`;
    if (!page.body.previousWeek || page.body.weekStart <= monthStart) break;
    week = page.body.previousWeek;
  }
  const transactions = [];
  const seen = new Set();
  for (const page of pages) {
    const monthStart = `${page.today.slice(0, 7)}-01`;
    for (const row of page.rows) {
      if (seen.has(row.id) || row.date < monthStart || row.date > page.today || !countsAsSpend(row)) continue;
      seen.add(row.id);
      transactions.push(row);
    }
  }
  transactions.sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0));
  return { snapshot, month, transactions };
}

function rowView(categories) {
  return categories.map((item) => ({
    slug: item.slug,
    name: item.name,
    spentCents: item.spentCents,
    capCents: item.capCents ?? null,
    percent: item.percent ?? null,
    estimate: Boolean(item.estimate),
    over: item.state === "over",
  }));
}

function assertParity(actual, old) {
  assert.equal(actual.spentCents, old.snapshot.spentCents);
  assert.equal(actual.budgetLabel, old.snapshot.budgetLabel);
  assert.deepEqual(actual.month, old.month);
  assert.deepEqual(rowView(actual.categories), rowView(old.snapshot.categories));
  assert.deepEqual(actual.transactions, old.transactions);
  assert.equal(actual.transactions.reduce((sum, row) => sum + spendCents(row), 0), actual.spentCents);
  assert.equal(actual.month.spentCents, actual.spentCents);
  for (const production of [false, true]) {
    assert.equal(showMonthBudget(production, actual.month), showMonthBudget(production, old.month));
  }
}

test("the month endpoint matches the old client walk, including over flags and the plan", () => {
  const caps = defaultCaps();
  const open = oldClientMonth(SEED_TRANSACTIONS, NOW, caps, undefined, false, undefined, {});
  const endpoint = spendingMonth(SEED_TRANSACTIONS, NOW, caps, undefined, false, undefined, MONTH, {});
  assert.equal(endpoint.status, 200);
  assertParity(endpoint.body, open);
  assert.equal(endpoint.body.transactions.length > 0, true);
  assert.equal(showMonthBudget(false, endpoint.body.month), true);
  assert.equal(showMonthBudget(true, endpoint.body.month), false);

  const tight = { ...caps, "dining-out": 100 };
  const overOld = oldClientMonth(SEED_TRANSACTIONS, NOW, tight, undefined, false, undefined, { VERCEL_ENV: "production" });
  const overNew = spendingMonth(SEED_TRANSACTIONS, NOW, tight, undefined, false, undefined, MONTH, { VERCEL_ENV: "production" });
  assert.equal(overNew.status, 200);
  assertParity(overNew.body, overOld);
  assert.equal(overNew.body.categories.some((item) => item.slug === "dining-out" && item.state === "over"), true);
  assert.equal(showMonthBudget(true, overNew.body.month), false);
  assert.equal(overNew.body.month.planCents, null);

  const savedOld = oldClientMonth(SEED_TRANSACTIONS, NOW, tight, undefined, true, undefined, { VERCEL_ENV: "production" });
  const savedNew = spendingMonth(SEED_TRANSACTIONS, NOW, tight, undefined, true, undefined, MONTH, { VERCEL_ENV: "production" });
  assertParity(savedNew.body, savedOld);
  assert.equal(savedNew.body.month.saved, true);
  assert.equal(showMonthBudget(true, savedNew.body.month), true);
  assert.equal(spendingMonth(SEED_TRANSACTIONS, NOW, caps, undefined, false, undefined, "2026-13").status, 400);
  assert.equal(spendingMonth(SEED_TRANSACTIONS, NOW, caps, undefined, false, undefined, "2026-10").status, 400);
});

async function oldFromStore(store, now) {
  const snapshot = await store.financeCategories(now, "month");
  const month = (await store.financeOverview(now, "", "YTD")).body.month;
  const pages = [];
  let week = "";
  for (let step = 0; step < 8; step += 1) {
    const page = await store.financeTransactions(now, week, "");
    if (page.status !== 200) break;
    pages.push(page.body);
    const monthStart = `${page.body.today.slice(0, 7)}-01`;
    if (!page.body.previousWeek || page.body.weekStart <= monthStart) break;
    week = page.body.previousWeek;
  }
  const transactions = [];
  const seen = new Set();
  for (const page of pages) {
    const monthStart = `${page.today.slice(0, 7)}-01`;
    for (const row of page.rows) {
      if (seen.has(row.id) || row.date < monthStart || row.date > page.today || !countsAsSpend(row)) continue;
      seen.add(row.id);
      transactions.push(row);
    }
  }
  transactions.sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0));
  return { snapshot, month, transactions };
}

test("the owner endpoint matches the store the page used to call", async () => {
  const store = installMemoryFinance(createStore());
  const env = { JOEHUB_DEV_AUTH: "1", JOEHUB_SESSION_SECRET: "speed-polish-secret-value" };
  const limiter = { allow: async () => true };
  const url = `http://127.0.0.1/api/finance/spending/month?month=${MONTH}`;
  assert.equal((await handleFinanceSpendingMonth(new Headers(), env, store, limiter, NOW, "127.0.0.1", url)).status, 401);
  const signed = login({ username: "synthetic", password: "synthetic" }, env, store, NOW);
  const headers = new Headers({ cookie: `joehub_session=${signed.cookie}` });
  const view = await handleFinanceSpendingMonth(headers, env, store, limiter, NOW, "127.0.0.1", url);
  assert.equal(view.status, 200);
  assertParity(view.body, await oldFromStore(store, NOW));
  const closed = await handleFinanceSpendingMonth(headers, env, store, limiter, NOW, "127.0.0.1", "http://127.0.0.1/api/finance/spending/month?month=2026-10");
  assert.equal(closed.status, 400);

  const budgets = {};
  for (const item of view.body.categories) {
    if (item.slug === "uncategorized") continue;
    budgets[item.slug] = item.slug === "dining-out" ? 100 : (item.capCents ?? 0);
  }
  assert.equal((await store.financeSaveBudgets({ budgets }, "parity-budgets")).status, 200);
  const saved = await handleFinanceSpendingMonth(headers, env, store, limiter, NOW, "127.0.0.1", url);
  assert.equal(saved.status, 200);
  assertParity(saved.body, await oldFromStore(store, NOW));
  assert.equal(saved.body.month.saved, true);
  assert.equal(showMonthBudget(true, saved.body.month), true);
  assert.equal(saved.body.categories.find((item) => item.slug === "dining-out").state, "over");
});

test("a repeated month read does not write Redis and loads rows in one MGET", async () => {
  const fake = await startFakeUpstash();
  try {
    const store = createUpstashStore({ url: fake.url, token: fake.token, env: { VERCEL_ENV: "preview" } });
    const first = await store.financeSpendingMonth(NOW, MONTH);
    assert.equal(first.status, 200);
    fake.commands.length = 0;
    const second = await store.financeSpendingMonth(NOW, MONTH);
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.month, first.body.month);
    assert.equal(fake.commands.some((args) => args[0] === "SET"), false);
    assert.equal(fake.commands.some((args) => args[0] === "MGET"), true);
    assert.equal(fake.commands.some((args) => args[0] === "GET" && String(args[1]).includes(":finance:txn:")), false);
  } finally {
    fake.stop();
  }
});
