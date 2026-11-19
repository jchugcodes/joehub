import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { categoriesSnapshot, countsAsSpend, installMemoryFinance, SEED_TRANSACTIONS, spendCents } from "../lib/finance.mjs";
import { financeTabs, isGatedPath } from "../lib/live-pages.mjs";
import { categoryBar } from "../lib/spending-bars.mjs";
import { spendingPath } from "../lib/spending-href.mjs";

const root = new URL("..", import.meta.url);

test("spending is live in production", () => {
  assert.equal(isGatedPath("/finance/spending"), false);
  assert.equal(isGatedPath("/finance/spending/more"), false);
  assert.equal(financeTabs({}).some((tab) => tab.href === "/finance/spending" && tab.shipped === true && tab.live === true), true);
  assert.deepEqual(
    financeTabs({ VERCEL_ENV: "production" }).map((tab) => tab.label),
    ["Overview", "Spending", "Accounts", "Bills"],
  );
  assert.equal(financeTabs({ NEXT_PUBLIC_VERCEL_ENV: "production" }).some((tab) => tab.href === "/finance/spending" && tab.live === true), true);
  assert.equal(financeTabs({}).filter((tab) => tab.label === "Spending").length, 1);
  assert.equal(financeTabs({}).some((tab) => tab.label === "Categories"), false);
  assert.equal(financeTabs({}).findIndex((tab) => tab.label === "Spending"), 1);
});

test("the spending page reads this month from the finance APIs and edits through the existing patch", () => {
  const page = readFileSync(new URL("app/finance/spending/page.tsx", root), "utf8");
  const ui = readFileSync(new URL("components/FinanceSpending.tsx", root), "utf8");
  assert.match(page, /dynamic = "force-dynamic"/);
  assert.match(ui, /showMonthBudget\(production, month\)/);
  assert.match(ui, /\/api\/finance\/categories/);
  assert.match(ui, /\/api\/finance\/overview/);
  assert.match(ui, /period === "week" \? "week" : "month"/);
  assert.match(ui, /spentCents > 0/);
  assert.match(ui, /SpendingSkeleton/);
  assert.match(ui, /data-state="empty"/);
  assert.match(ui, /data-state="offline"/);
  assert.match(ui, /LoadError/);
  assert.match(ui, /\/api\/finance\/transactions/);
  assert.match(ui, /method: "PATCH"/);
  assert.match(ui, /countsAsSpend/);
  assert.match(ui, /spendCents/);
  assert.match(ui, /OverlayPanel/);
  assert.match(ui, /data-list-spent/);
  assert.match(ui, /left\.date < right\.date \? 1/);
  assert.match(ui, /disabled=\{!canSave\}/);
  assert.match(ui, /form=\{editing\}/);
  assert.match(ui, /onBack=\{editing \? closeEdit/);
  assert.match(ui, /slim=\{editing\}/);
  assert.match(ui, /!row\.meta\.includes\("Uncategorized"\)/);
  assert.match(ui, /data-edit-context/);
  assert.match(ui, /txnMoney\(selected\.amountCents\)/);
  assert.match(ui, /row\.uncategorized \? "uncategorized"/);
  assert.match(ui, /No spending this month\./);
  assert.match(ui, /Monthly budgets/);
  assert.match(ui, /id="budget-form"/);
  assert.match(ui, /\/api\/finance\/budgets/);
  assert.match(ui, /data-category-detail="true"/);
  assert.match(ui, /data-period-track="true"/);
  assert.match(ui, /Edit budgets/);
  assert.match(ui, /set\("cat"/);
  assert.match(ui, /categoryBar\(item, spent\)/);
  assert.match(ui, /data-bar=\{bar\.mode\}/);
  assert.match(ui, /data-over=\{bar\.over \? "true" : "false"\}/);
  assert.match(readFileSync(new URL("lib/spending-bars.mjs", root), "utf8"), /var\(--chart-negative\)/);
  assert.doesNotMatch(ui, /\/finance\/categories\/\$\{/);
  assert.doesNotMatch(ui, /#[0-9A-Fa-f]{3,8}/);
  assert.doesNotMatch(ui, /Previous month|Next month|aria-label="Previous|aria-label="Next/);
  assert.doesNotMatch(ui, /UPSTASH|overlay-flag|Ledger|reset-ledger/);
});

test("category bars fill against the estimate and share only when there is no cap", () => {
  const now = Date.parse("2026-11-10T15:00:00-05:00");
  const month = categoriesSnapshot(SEED_TRANSACTIONS, now, "month");
  const groceries = month.categories.find((item) => item.slug === "groceries");
  const dining = month.categories.find((item) => item.slug === "dining-out");
  const utilities = month.categories.find((item) => item.slug === "utilities");
  const uncategorized = month.categories.find((item) => item.slug === "uncategorized");
  const over = categoryBar(groceries, month.spentCents);
  assert.ok(groceries.percent > 100);
  assert.equal(over.mode, "estimate");
  assert.equal(over.over, true);
  assert.equal(over.width, 100);
  assert.equal(over.color, "var(--chart-negative)");
  const under = categoryBar(dining, month.spentCents);
  assert.equal(dining.percent, 72);
  assert.equal(under.mode, "estimate");
  assert.equal(under.over, false);
  assert.equal(under.width, dining.percent);
  assert.notEqual(under.color, "var(--chart-negative)");
  for (const row of [utilities, uncategorized]) {
    const share = Math.min(100, Math.max(1, Math.round((row.spentCents / month.spentCents) * 100)));
    const bar = categoryBar(row, month.spentCents);
    assert.equal(row.capCents, null);
    assert.equal(bar.mode, "share");
    assert.equal(bar.over, false);
    assert.equal(bar.width, share);
    assert.notEqual(bar.color, "var(--chart-negative)");
  }
  const week = categoriesSnapshot(SEED_TRANSACTIONS, now, "week");
  const weekDining = week.categories.find((item) => item.slug === "dining-out");
  const weekOver = categoryBar(weekDining, week.spentCents);
  assert.ok(weekDining.percent > 100);
  assert.equal(weekOver.mode, "estimate");
  assert.equal(weekOver.width, 100);
  assert.equal(weekOver.over, true);
  const weekUtilities = week.categories.find((item) => item.slug === "utilities");
  const weekShare = categoryBar(weekUtilities, week.spentCents);
  assert.equal(weekUtilities.percent, null);
  assert.equal(weekUtilities.status, "No cap set");
  assert.equal(weekShare.mode, "share");
  assert.equal(weekShare.over, false);
  assert.equal(weekShare.width, Math.min(100, Math.max(1, Math.round((weekUtilities.spentCents / week.spentCents) * 100))));
  assert.notEqual(weekShare.color, "var(--chart-negative)");
});

test("category urls redirect onto spending and keep the query", () => {
  const list = readFileSync(new URL("app/finance/categories/page.tsx", root), "utf8");
  const slug = readFileSync(new URL("app/finance/categories/[slug]/page.tsx", root), "utf8");
  const middleware = readFileSync(new URL("middleware.ts", root), "utf8");
  const config = readFileSync(new URL("next.config.ts", root), "utf8");
  assert.match(list, /permanentRedirect\(spendingPath/);
  assert.match(slug, /permanentRedirect\(spendingPath/);
  assert.match(config, /source: "\/finance\/categories"/);
  assert.match(config, /source: "\/finance\/categories\/:slug"/);
  assert.match(config, /destination: "\/finance\/spending\?cat=:slug"/);
  assert.match(config, /permanent: true/);
  assert.doesNotMatch(middleware, /x-forwarded-host|headers\.get\(["']host["']\)|headers\.get\(["']x-forwarded-host["']\)/);
  const month = new URL(spendingPath({ period: "month", asOf: "2026-11-11T15:00:00-05:00", panel: "1" }), "http://local");
  assert.equal(month.pathname, "/finance/spending");
  assert.equal(month.searchParams.get("period"), "month");
  assert.equal(month.searchParams.get("asOf"), "2026-11-11T15:00:00-05:00");
  assert.equal(month.searchParams.get("panel"), "1");
  assert.equal(month.searchParams.get("cat"), null);
  const dining = new URL(spendingPath({ period: "month", xe: "offline", asOf: "2026-11-11T15:00:00-05:00" }, "dining-out"), "http://local");
  assert.equal(dining.pathname, "/finance/spending");
  assert.equal(dining.searchParams.get("cat"), "dining-out");
  assert.equal(dining.searchParams.get("period"), "month");
  assert.equal(dining.searchParams.get("xe"), "offline");
  assert.equal(spendingPath({}), "/finance/spending");
  const overview = readFileSync(new URL("components/FinanceOverview.tsx", root), "utf8");
  assert.match(overview, /\/finance\/spending\?cat=/);
  assert.doesNotMatch(overview, /\/finance\/categories/);
});

test("this month's spending rows reconcile with the month total", async () => {
  const now = Date.parse("2026-11-18T12:00:00-05:00");
  const store = installMemoryFinance({});
  const snapshot = await store.financeCategories(now, "month");
  const collected = [];
  const seen = new Set();
  let week = "";
  for (let step = 0; step < 8; step += 1) {
    const page = await store.financeTransactions(now, week);
    assert.equal(page.status, 200);
    const monthStart = `${page.body.today.slice(0, 7)}-01`;
    for (const row of page.body.rows) {
      if (seen.has(row.id) || row.date < monthStart || row.date > page.body.today || !countsAsSpend(row)) continue;
      seen.add(row.id);
      collected.push(row);
    }
    if (!page.body.previousWeek || page.body.weekStart <= monthStart) break;
    week = page.body.previousWeek;
  }
  assert.ok(collected.length > 0);
  assert.equal(collected.some((row) => row.type === "income" || row.type === "transfer"), false);
  assert.equal(collected.some((row) => row.type === "refund"), true);
  assert.equal(collected.reduce((sum, row) => sum + spendCents(row), 0), snapshot.spentCents);
  collected.sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0));
  const dates = collected.map((row) => row.date);
  assert.deepEqual(dates, dates.slice().sort((left, right) => (left < right ? 1 : left > right ? -1 : 0)));
});

test("recategorizing moves spend and a transfer leaves the month total", async () => {
  const now = Date.parse("2026-11-18T12:00:00-05:00");
  const store = installMemoryFinance({});
  const before = await store.financeCategories(now, "month");
  const spent = (snapshot, slug) => snapshot.categories.find((item) => item.slug === slug).spentCents;
  const transport = spent(before, "transport");
  const groceries = spent(before, "groceries");
  const patched = await store.financePatchTransaction(
    "fin-shell",
    { payee: "Shell (example)", amountCents: -2218, date: "2026-11-09", type: "expense", category: "groceries" },
    now,
  );
  assert.equal(patched.status, 200);
  assert.equal(patched.body.category, "groceries");
  assert.equal(patched.body.corrected, true);
  const moved = await store.financeCategories(now, "month");
  assert.equal(spent(moved, "transport"), transport - 2218);
  assert.equal(spent(moved, "groceries"), groceries + 2218);
  assert.equal(moved.spentCents, before.spentCents);
  const transfer = await store.financePatchTransaction(
    "fin-pizza",
    { payee: "Joe's Pizza", amountCents: -3240, date: "2026-11-10", type: "transfer", category: null },
    now,
  );
  assert.equal(transfer.status, 200);
  assert.equal(transfer.body.type, "transfer");
  const after = await store.financeCategories(now, "month");
  assert.equal(after.spentCents, before.spentCents - 3240);
  const page = await store.financeTransactions(now, "");
  const monthStart = `${page.body.today.slice(0, 7)}-01`;
  const listed = page.body.rows.filter((row) => row.date >= monthStart && row.date <= page.body.today && countsAsSpend(row));
  assert.equal(listed.some((row) => row.id === "fin-pizza"), false);
});
