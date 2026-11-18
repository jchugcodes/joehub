import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { countsAsSpend, installMemoryFinance, spendCents } from "../lib/finance.mjs";
import { financeTabs, isGatedPath } from "../lib/live-pages.mjs";

const root = new URL("..", import.meta.url);

test("spending is shipped for preview and gated in production", () => {
  assert.equal(isGatedPath("/finance/spending"), true);
  assert.equal(isGatedPath("/finance/spending/more"), true);
  assert.equal(financeTabs({}).some((tab) => tab.href === "/finance/spending" && tab.shipped === true && tab.live === false), true);
  assert.equal(financeTabs({ VERCEL_ENV: "production" }).some((tab) => tab.label === "Spending"), false);
  assert.equal(financeTabs({ NEXT_PUBLIC_VERCEL_ENV: "production" }).some((tab) => tab.href === "/finance/spending"), false);
});

test("the spending page reads this month from the finance APIs and stays read-only", () => {
  const page = readFileSync(new URL("app/finance/spending/page.tsx", root), "utf8");
  const ui = readFileSync(new URL("components/FinanceSpending.tsx", root), "utf8");
  assert.match(page, /dynamic = "force-dynamic"/);
  assert.match(ui, /showMonthBudget\(production, month\)/);
  assert.match(ui, /\/api\/finance\/categories/);
  assert.match(ui, /\/api\/finance\/overview/);
  assert.match(ui, /period", "month"/);
  assert.match(ui, /spentCents > 0/);
  assert.match(ui, /SpendingSkeleton/);
  assert.match(ui, /data-state="empty"/);
  assert.match(ui, /data-state="offline"/);
  assert.match(ui, /LoadError/);
  assert.match(ui, /\/api\/finance\/transactions/);
  assert.match(ui, /countsAsSpend/);
  assert.match(ui, /spendCents/);
  assert.match(ui, /OverlayPanel/);
  assert.match(ui, /data-list-spent/);
  assert.match(ui, /left\.date < right\.date \? 1/);
  assert.doesNotMatch(ui, /Previous month|Next month|aria-label="Previous|aria-label="Next/);
  assert.doesNotMatch(ui, /UPSTASH|overlay-flag|Ledger/);
  assert.doesNotMatch(ui, />\s*Edit\s*</);
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
