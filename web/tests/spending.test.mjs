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

test("the spending page reads this month from the finance APIs and edits through the existing patch", () => {
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
  assert.doesNotMatch(ui, /#[0-9A-Fa-f]{3,8}/);
  assert.doesNotMatch(ui, /Previous month|Next month|aria-label="Previous|aria-label="Next/);
  assert.doesNotMatch(ui, /UPSTASH|overlay-flag|Ledger|reset-ledger/);
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
