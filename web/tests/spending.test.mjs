import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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
  assert.doesNotMatch(ui, /Previous month|Next month|aria-label="Previous|aria-label="Next/);
  assert.doesNotMatch(ui, /UPSTASH|overlay-flag|Ledger/);
});
