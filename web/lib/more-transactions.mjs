/** Synthetic transactions from the v2 More handoff. Not live records. */

export const TRANSACTIONS = [
  { id: "example-tx-01", date: "2026-11-06", merchant: "Joe's Pizza", category: "Dining Out", amount: -14.5, currency: "USD", accountAlias: "Card A", reviewed: true },
  { id: "example-tx-02", date: "2026-11-05", merchant: "Trader Joe's", category: "Groceries", amount: -46.12, currency: "USD", accountAlias: "Card A", reviewed: true },
  { id: "example-tx-03", date: "2026-11-05", merchant: "MTA", category: "Transport", amount: -2.9, currency: "USD", accountAlias: "Card B", reviewed: true },
  { id: "example-tx-04", date: "2026-11-04", merchant: "Sweetgreen", category: "Dining Out", amount: -16.25, currency: "USD", accountAlias: "Card A", reviewed: false },
  { id: "example-tx-05", date: "2026-11-03", merchant: "Spotify", category: "Subscriptions", amount: -11.99, currency: "USD", accountAlias: "Card B", reviewed: true },
  { id: "example-tx-06", date: "2026-11-02", merchant: "Con Ed", category: "Utilities", amount: -63.4, currency: "USD", accountAlias: "Checking", reviewed: true },
  { id: "example-tx-07", date: "2026-11-01", merchant: "Payroll", category: "Income", amount: 2350, currency: "USD", accountAlias: "Checking", reviewed: true },
  { id: "example-tx-08", date: "2026-10-31", merchant: "Lilia", category: "Dining Out", amount: -88, currency: "USD", accountAlias: "Card A", reviewed: true },
  { id: "example-tx-09", date: "2026-10-30", merchant: "Uber", category: "Transport", amount: -18.7, currency: "USD", accountAlias: "Card B", reviewed: false },
  { id: "example-tx-10", date: "2026-10-30", merchant: "Netflix", category: "Subscriptions", amount: -15.49, currency: "USD", accountAlias: "Card B", reviewed: true },
  { id: "example-tx-11", date: "2026-10-29", merchant: "Whole Foods", category: "Groceries", amount: -52.33, currency: "USD", accountAlias: "Card A", reviewed: true },
  { id: "example-tx-12", date: "2026-10-28", merchant: "Amazon", category: "Shopping", amount: -24.99, currency: "USD", accountAlias: "Card A", reviewed: true },
  { id: "example-tx-13", date: "2026-10-27", merchant: "Citi Bike", category: "Transport", amount: -4.49, currency: "USD", accountAlias: "Card B", reviewed: true },
  { id: "example-tx-14", date: "2026-10-26", merchant: "Loan pmt", category: "Debt", amount: -400, currency: "USD", accountAlias: "Checking", reviewed: true },
];

const SORTS = ["date-desc", "amount-asc", "amount-desc"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function cycleSort(sort) {
  const index = SORTS.indexOf(sort);
  return SORTS[(index + 1) % SORTS.length];
}

export function toggleSort(sort, column) {
  if (column === "date") return sort === "date-desc" ? "date-asc" : "date-desc";
  return sort === "amount-asc" ? "amount-desc" : "amount-asc";
}

export function sortTransactions(rows, sort) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      let diff = 0;
      if (sort === "amount-asc" || sort === "amount-desc") {
        diff = left.row.amount - right.row.amount;
        if (sort === "amount-desc") diff = -diff;
      } else {
        diff = left.row.date < right.row.date ? -1 : left.row.date > right.row.date ? 1 : 0;
        if (sort === "date-desc") diff = -diff;
      }
      return diff === 0 ? left.index - right.index : diff;
    })
    .map((item) => item.row);
}

export function filterTransactions(rows, filters) {
  return rows.filter((row) => {
    if (filters.month === "2026-11" && !row.date.startsWith("2026-11")) return false;
    if (filters.amount === "expense" && !(row.amount < 0)) return false;
    if (filters.amount === "income" && !(row.amount > 0)) return false;
    if (filters.account !== "all" && row.accountAlias !== filters.account) return false;
    return true;
  });
}

export function nextMonth(month) {
  return month === "all" ? "2026-11" : "all";
}

export function nextAmount(amount) {
  if (amount === "all") return "expense";
  if (amount === "expense") return "income";
  return "all";
}

export function nextAccount(account) {
  if (account === "all") return "Card A";
  if (account === "Card A") return "Card B";
  if (account === "Card B") return "Checking";
  return "all";
}

export function formatDay(iso) {
  const [, month, day] = iso.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}`;
}

export function formatLong(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

function absMoney(amount) {
  return Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatTableAmount(amount) {
  if (amount > 0) return `+${absMoney(amount)}`;
  if (amount < 0) return `−${absMoney(amount)}`;
  return absMoney(amount);
}

export function formatSheetAmount(amount) {
  if (amount > 0) return `+$${absMoney(amount)}`;
  if (amount < 0) return `−$${absMoney(amount)}`;
  return `$${absMoney(amount)}`;
}

export function sortLabel(sort) {
  if (sort === "amount-asc") return "Amount ↑";
  if (sort === "amount-desc") return "Amount ↓";
  if (sort === "date-asc") return "Date ↑";
  return "Date ↓";
}
