import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "../lib/sessions.mjs";
import { capsForWeek, categoriesSnapshot, categoryView, chartFor, createTransaction, daysLeft, ENVELOPE_CENTS, installMemoryFinance, monthProgress, monthlyBudgetCents, overview, parseCaps, patchTransaction, resetLedger, SEED_TRANSACTIONS, simulateLedgerRefresh, transactionsForWeek, weekStart } from "../lib/finance.mjs";

const NOW = Date.parse("2026-11-10T15:00:00-05:00");

test("Detroit weeks, caps, month, and chart ranges come from the seed", () => {
  assert.equal(weekStart("2026-11-10"), "2026-11-09");
  assert.equal(daysLeft("2026-11-09", "2026-11-09"), 7);
  assert.equal(daysLeft("2026-11-10", "2026-11-09"), 6);
  assert.equal(daysLeft("2026-11-15", "2026-11-09"), 1);
  assert.equal(daysLeft("2026-11-10", "2026-10-26"), null);

  const current = capsForWeek(SEED_TRANSACTIONS, "2026-11-09");
  const dining = current.find((cap) => cap.slug === "dining-out");
  const groceries = current.find((cap) => cap.slug === "groceries");
  const transport = current.find((cap) => cap.slug === "transport");
  const subs = current.find((cap) => cap.slug === "subscriptions");
  const utilities = current.find((cap) => cap.slug === "utilities");
  assert.equal(dining.spentCents, 9200);
  assert.equal(dining.state, "over");
  assert.equal(dining.fill, 100);
  assert.equal(dining.status, "$12 over");
  assert.equal(groceries.percent, 90);
  assert.equal(groceries.state, "near");
  assert.equal(transport.spentCents, 4718);
  assert.equal(transport.percent, 79);
  assert.equal(subs.percent, 85);
  assert.equal(subs.state, "under");
  assert.equal(subs.tone, "category");
  assert.equal(utilities.state, "none");
  assert.equal(utilities.status, "No cap set");
  assert.equal(current.reduce((sum, cap) => sum + cap.spentCents, 0), 37603);

  const earlier = capsForWeek(SEED_TRANSACTIONS, "2026-11-02");
  assert.equal(earlier.find((cap) => cap.slug === "dining-out").spentCents, 15600);
  assert.equal(earlier.find((cap) => cap.slug === "groceries").spentCents, 20400);
  assert.equal(earlier.find((cap) => cap.slug === "utilities").spentCents, 4820);
  assert.equal(capsForWeek(SEED_TRANSACTIONS, "2026-10-26").every((cap) => cap.spentCents === 0), true);

  const month = monthProgress(SEED_TRANSACTIONS, "2026-11-10");
  assert.equal(month.spentCents, 112600);
  assert.equal(month.percent, 27);
  assert.equal(month.day, 10);
  assert.equal(month.days, 30);

  const view = overview(SEED_TRANSACTIONS, NOW, "", "YTD");
  assert.equal(view.status, 200);
  assert.equal(view.body.label, "This week · Nov 9–15");
  assert.equal(view.body.daysLeft, 6);
  assert.equal(view.body.netWorthCents, 1847236);
  assert.equal(view.body.chart.caption, "+$1,284.10 (7.5%) YTD");
  assert.equal(view.body.chart.points[0], 1718826);
  assert.equal(view.body.chart.points.at(-1), 1847236);
  assert.equal(view.body.recent[0].payee, "Payroll (example)");
  assert.equal(view.body.recent[0].type, "income");
  assert.equal(view.body.recent.find((row) => row.payee === "Northside Market").category, "groceries");
  const diningView = categoryView(SEED_TRANSACTIONS, NOW, "2026-11-09", "dining-out");
  assert.equal(diningView.body.rows.length, 5);
  assert.equal(diningView.body.rows.reduce((sum, row) => sum - row.amountCents, 0), 9200);

  const ranges = ["1W", "1M", "YTD", "1Y", "All"].map((range) => chartFor(SEED_TRANSACTIONS, "2026-11-10", range).points.join(","));
  assert.equal(new Set(ranges).size, 5);
  const week = chartFor(SEED_TRANSACTIONS, "2026-11-10", "1W");
  assert.deepEqual(week.points, [38543]);
  const oneMonth = chartFor(SEED_TRANSACTIONS, "2026-11-10", "1M");
  assert.deepEqual(oneMonth.points, [74057, 38543]);
  assert.equal(monthlyBudgetCents(8000), 34300);
  assert.equal(monthlyBudgetCents(12000), 51400);
  assert.equal(monthlyBudgetCents(6000), 25700);
  assert.equal(monthlyBudgetCents(5500), 23600);
  assert.equal(monthlyBudgetCents(7500), 32100);
  assert.equal(monthlyBudgetCents(0), null);
  const monthCategories = categoriesSnapshot(SEED_TRANSACTIONS, NOW, "month");
  assert.equal(monthCategories.spentCents, 112600);
  assert.equal(monthCategories.budgetCents, 167100);
  assert.equal(monthCategories.aside, "Day 10 of 30");
  const diningMonth = monthCategories.categories.find((cap) => cap.slug === "dining-out");
  const groceriesMonth = monthCategories.categories.find((cap) => cap.slug === "groceries");
  const transportMonth = monthCategories.categories.find((cap) => cap.slug === "transport");
  const subsMonth = monthCategories.categories.find((cap) => cap.slug === "subscriptions");
  const shoppingMonth = monthCategories.categories.find((cap) => cap.slug === "shopping");
  const utilitiesMonth = monthCategories.categories.find((cap) => cap.slug === "utilities");
  const uncategorized = monthCategories.categories.find((cap) => cap.slug === "uncategorized");
  assert.equal(diningMonth.spentCents, 24800);
  assert.equal(diningMonth.percent, 72);
  assert.equal(diningMonth.status, "$95 left");
  assert.equal(groceriesMonth.spentCents, 31200);
  assert.equal(groceriesMonth.percent, 61);
  assert.equal(transportMonth.spentCents, 14118);
  assert.equal(transportMonth.percent, 55);
  assert.equal(subsMonth.spentCents, 4675);
  assert.equal(subsMonth.percent, 20);
  assert.equal(shoppingMonth.spentCents, 7800);
  assert.equal(shoppingMonth.percent, 24);
  assert.equal(utilitiesMonth.capCents, null);
  assert.equal(utilitiesMonth.spentCents, 11230);
  assert.equal(uncategorized.spentCents, 18777);
  const november = categoryView(SEED_TRANSACTIONS, NOW, "2026-11-09", "dining-out", undefined, undefined, "month");
  assert.equal(november.body.rows.length, 10);
  assert.equal(november.body.rows.reduce((sum, row) => sum - row.amountCents, 0), 24800);
  assert.equal(november.body.rows[0].payee, "Joe's Pizza");
  assert.equal(november.body.rows[4].payee, "Cafe Norte (example)");
  assert.equal(november.body.rows.at(-1).payee, "Riverside Cafe");
  const weekCategories = categoriesSnapshot(SEED_TRANSACTIONS, Date.parse("2026-11-11T13:30:00.000Z"), "week");
  assert.equal(weekCategories.spentCents, 37603);
  assert.equal(weekCategories.aside, "5 days left");
  assert.equal(weekCategories.categories.some((cap) => cap.slug === "uncategorized"), false);
  const all = chartFor(SEED_TRANSACTIONS, "2026-11-10", "All");
  assert.equal(all.points[0], 1500);
  assert.equal(all.points.includes(0), false);
  const year = chartFor(SEED_TRANSACTIONS, "2026-11-10", "1Y");
  assert.equal(year.points.includes(1500), false);
  assert.equal(year.points.includes(0), false);
  assert.ok(year.points.length < all.points.length);

  const empty = overview(SEED_TRANSACTIONS, NOW, "2026-10-19", "YTD");
  assert.equal(empty.body.label, "Oct 19–25");
  assert.equal(empty.body.empty, true);
  assert.equal(empty.body.daysLeft, null);
  assert.equal(empty.body.netWorthCents, 1847236);
  assert.equal(empty.body.caps.every((cap) => cap.spentCents === 0), true);
});

test("moving budget keeps the $390 total and rejects an over-move", async () => {
  const moved = parseCaps({
    "dining-out": 9000,
    groceries: 11000,
    transport: 6000,
    subscriptions: 5500,
    shopping: 7500,
    utilities: 0,
  });
  assert.equal(moved.ok, true);
  assert.equal(Object.values(moved.caps).reduce((sum, value) => sum + value, 0), ENVELOPE_CENTS);
  const over = parseCaps({
    "dining-out": 10000,
    groceries: 12000,
    transport: 6000,
    subscriptions: 5500,
    shopping: 7500,
    utilities: 0,
  });
  assert.equal(over.ok, false);
  assert.equal(over.field, "dining-out");
  assert.equal(over.detail, "That total has to stay $390.");
  assert.equal(parseCaps({ "dining-out": -1, groceries: 12000, transport: 6000, subscriptions: 5500, shopping: 7500, utilities: 0 }).detail, "Can’t be negative.");
  assert.equal(parseCaps({ "dining-out": 80.5, groceries: 12000, transport: 6000, subscriptions: 5500, shopping: 7500, utilities: 0 }).detail, "Enter an amount.");
  const cleared = parseCaps({
    "dining-out": 0,
    groceries: 20000,
    transport: 6000,
    subscriptions: 5500,
    shopping: 7500,
    utilities: 0,
  });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.caps["dining-out"], 0);

  const store = installMemoryFinance(createStore());
  const saved = await store.financeSaveCaps({
    caps: { "dining-out": 9000, groceries: 11000, transport: 6000, subscriptions: 5500, shopping: 7500, utilities: 0 },
  }, "cap-1");
  assert.equal(saved.status, 200);
  const again = await store.financeSaveCaps({ caps: { "dining-out": 1 } }, "cap-1");
  assert.equal(again.body.caps["dining-out"], 9000);
  const view = await store.financeOverview(NOW, "2026-11-09", "YTD");
  assert.equal(view.body.caps.find((cap) => cap.slug === "dining-out").capCents, 9000);
  assert.equal(view.body.caps.find((cap) => cap.slug === "dining-out").status, "$2 over");
  const rejected = await store.financeSaveCaps({
    caps: { "dining-out": "nope", groceries: 12000, transport: 6000, subscriptions: 5500, shopping: 7500, utilities: 0 },
  }, "cap-bad");
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.field, "dining-out");
  assert.equal(view.body.caps.find((cap) => cap.slug === "dining-out").capCents, 9000);
});

test("transactions add, recategorize, transfer, income, and refund through the store", async () => {
  const dining = () => capsForWeek(SEED_TRANSACTIONS, "2026-11-09").find((cap) => cap.slug === "dining-out").spentCents;
  const before = dining();
  const blank = createTransaction([], { payee: "  ", amountCents: 100, date: "2026-11-10", type: "expense" }, NOW, 1);
  assert.equal(blank.status, 400);
  assert.equal(blank.body.field, "payee");
  const uncategorized = createTransaction(SEED_TRANSACTIONS, { payee: "Corner cafe", amountCents: 1250, date: "2026-11-10", type: "expense", category: null }, NOW, 1);
  assert.equal(uncategorized.status, 201);
  assert.equal(uncategorized.body.uncategorized, true);
  assert.equal(capsForWeek(uncategorized.rows, "2026-11-09").find((cap) => cap.slug === "dining-out").spentCents, before);
  const listed = transactionsForWeek(uncategorized.rows, NOW, "2026-11-09");
  assert.equal(listed.body.rows.some((row) => row.payee === "Corner cafe"), true);
  assert.equal(transactionsForWeek(SEED_TRANSACTIONS, NOW, "2026-11-16").status, 400);

  const income = createTransaction(SEED_TRANSACTIONS, { payee: "Side gig", amountCents: -5000, date: "2026-11-10", type: "income", category: "dining-out" }, NOW, 2);
  assert.equal(income.body.amountCents, 5000);
  assert.equal(income.body.category, null);
  assert.equal(capsForWeek(income.rows, "2026-11-09").find((cap) => cap.slug === "dining-out").spentCents, before);

  const refund = createTransaction(SEED_TRANSACTIONS, { payee: "Mug return", amountCents: 400, date: "2026-11-10", type: "refund", category: "dining-out" }, NOW, 3);
  assert.equal(capsForWeek(refund.rows, "2026-11-09").find((cap) => cap.slug === "dining-out").spentCents, before - 400);

  const moved = patchTransaction(SEED_TRANSACTIONS, "fin-pizza", { type: "expense", category: "groceries" }, NOW);
  assert.equal(moved.status, 200);
  assert.equal(moved.body.category, "groceries");
  assert.equal(moved.rows.find((row) => row.id === "fin-pizza").category, "groceries");
  const groceriesBefore = capsForWeek(SEED_TRANSACTIONS, "2026-11-09").find((cap) => cap.slug === "groceries").spentCents;
  assert.equal(capsForWeek(moved.rows, "2026-11-09").find((cap) => cap.slug === "dining-out").spentCents, before - 3240);
  assert.equal(capsForWeek(moved.rows, "2026-11-09").find((cap) => cap.slug === "groceries").spentCents, groceriesBefore + 3240);

  const transfer = patchTransaction(SEED_TRANSACTIONS, "fin-vendor", { type: "transfer" }, NOW);
  assert.equal(transfer.body.type, "transfer");
  assert.equal(transfer.body.category, null);
  const shell = patchTransaction(SEED_TRANSACTIONS, "fin-shell", { type: "expense", category: "shopping", amountCents: 2218 }, NOW);
  assert.equal(shell.body.corrected, true);
  assert.equal(shell.body.category, "shopping");
  assert.equal(shell.rows.find((row) => row.id === "fin-shell").category, "transport");
  assert.equal(shell.rows.find((row) => row.id === "fin-shell").correction.category, "shopping");

  const store = installMemoryFinance(createStore());
  const created = await store.financeCreateTransaction({ payee: "Corner cafe", amountCents: 1250, date: "2026-11-10", type: "expense" }, NOW, "create-1");
  assert.equal(created.status, 201);
  const replay = await store.financeCreateTransaction({ payee: "Other", amountCents: 900, date: "2026-11-10", type: "expense" }, NOW, "create-1");
  assert.equal(replay.body.id, created.body.id);
  const week = await store.financeTransactions(NOW, "2026-11-09");
  assert.equal(week.body.rows.filter((row) => row.payee === "Corner cafe").length, 1);
  const failed = await store.financeCreateTransaction({ payee: "", amountCents: 100, date: "2026-11-10", type: "expense" }, NOW, "create-bad");
  assert.equal(failed.status, 400);
  assert.equal((await store.financeTransactions(NOW, "2026-11-09")).body.rows.filter((row) => row.payee === "Corner cafe").length, 1);
});

test("a ledger refresh keeps the Shell correction until a confirmed reset", () => {
  const refreshed = simulateLedgerRefresh(SEED_TRANSACTIONS, NOW);
  const shell = refreshed.find((row) => row.id === "fin-shell");
  assert.equal(shell.ledger.latest.amountCents, -2418);
  assert.equal(shell.ledger.latest.category, "shopping");
  assert.equal(shell.correction.category, "transport");
  assert.equal(refreshed.find((row) => row.id === "fin-pizza").ledger, undefined);
  const during = capsForWeek(refreshed, "2026-11-09");
  assert.equal(during.find((cap) => cap.slug === "transport").spentCents, 4718);
  assert.equal(during.find((cap) => cap.slug === "shopping").spentCents, 1800);
  const reset = resetLedger(refreshed, "fin-shell");
  assert.equal(reset.status, 200);
  assert.equal(reset.body.corrected, false);
  assert.equal(reset.body.category, "shopping");
  assert.equal(reset.body.amountCents, -2418);
  assert.equal(capsForWeek(reset.rows, "2026-11-09").find((cap) => cap.slug === "shopping").spentCents, 4218);
  assert.equal(resetLedger(SEED_TRANSACTIONS, "fin-pizza").status, 400);
  assert.equal(resetLedger(SEED_TRANSACTIONS, "missing").status, 404);
});
