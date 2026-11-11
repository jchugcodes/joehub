import assert from "node:assert/strict";
import test from "node:test";
import { capsForWeek, categoryView, chartFor, daysLeft, monthProgress, overview, SEED_TRANSACTIONS, weekStart } from "../lib/finance.mjs";

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

  const span = capsForWeek(SEED_TRANSACTIONS, "2026-10-26");
  assert.equal(span.find((cap) => cap.slug === "dining-out").percent, 93);
  assert.equal(span.find((cap) => cap.slug === "groceries").spentCents, 8840);
  assert.equal(span.find((cap) => cap.slug === "utilities").spentCents, 0);

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
  assert.equal(new Set(ranges).size, 4);
  const week = chartFor(SEED_TRANSACTIONS, "2026-11-10", "1W");
  assert.deepEqual(week.points, [38543]);
  const oneMonth = chartFor(SEED_TRANSACTIONS, "2026-11-10", "1M");
  assert.deepEqual(oneMonth.points, [26115, 47942, 38543]);
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
