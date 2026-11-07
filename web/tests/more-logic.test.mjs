import assert from "node:assert/strict";
import test from "node:test";
import {
  TRANSACTIONS,
  cycleSort,
  filterTransactions,
  formatSheetAmount,
  formatTableAmount,
  nextAccount,
  nextAmount,
  sortTransactions,
  toggleSort,
} from "../lib/more-transactions.mjs";

const all = { month: "all", amount: "all", account: "all" };

test("default date order keeps same-day fixture order and amount sort is signed", () => {
  const dated = sortTransactions(TRANSACTIONS, "date-desc");
  assert.equal(dated[0].merchant, "Joe's Pizza");
  assert.deepEqual(
    dated.filter((row) => row.date === "2026-11-05").map((row) => row.merchant),
    ["Trader Joe's", "MTA"],
  );
  assert.deepEqual(
    dated.filter((row) => row.date === "2026-10-30").map((row) => row.merchant),
    ["Uber", "Netflix"],
  );
  const amounts = sortTransactions(TRANSACTIONS, "amount-asc").map((row) => row.merchant);
  assert.equal(amounts[0], "Loan pmt");
  assert.equal(amounts.at(-1), "Payroll");
  assert.deepEqual(cycleSort("date-desc"), "amount-asc");
  assert.deepEqual(cycleSort("amount-asc"), "amount-desc");
  assert.deepEqual(cycleSort("amount-desc"), "date-desc");
  assert.equal(toggleSort("amount-asc", "amount"), "amount-desc");
  assert.equal(toggleSort("date-desc", "date"), "date-asc");
  assert.equal(formatTableAmount(2350), "+2,350.00");
  assert.equal(formatTableAmount(-14.5), "−14.50");
  assert.equal(formatSheetAmount(-14.5), "−$14.50");
});

test("filters combine and a zero amount is neither expense nor income", () => {
  const november = filterTransactions(TRANSACTIONS, { month: "2026-11", amount: "expense", account: "all" });
  assert.equal(november.length, 6);
  assert.equal(november.some((row) => row.merchant === "Payroll"), false);
  const none = filterTransactions(TRANSACTIONS, { month: "2026-11", amount: "income", account: "Card A" });
  assert.equal(none.length, 0);
  const withZero = filterTransactions(
    [...TRANSACTIONS, { id: "example-tx-00", date: "2026-11-01", merchant: "Zero", category: "Income", amount: 0, currency: "USD", accountAlias: "Card A", reviewed: false }],
    { month: "2026-11", amount: "income", account: "Card A" },
  );
  assert.equal(withZero.length, 0);
  assert.equal(filterTransactions(TRANSACTIONS, all).length, 14);
  assert.equal(nextAmount("all"), "expense");
  assert.equal(nextAmount("expense"), "income");
  assert.equal(nextAmount("income"), "all");
  assert.equal(nextAccount("Checking"), "all");
});
