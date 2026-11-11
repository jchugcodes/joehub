/**
 * Production shows only the live primary tabs and the live Finance subtabs.
 * Preview and local dev keep the full nav. Flip a Finance subtab on by setting live: true.
 * Debts is shipped for preview. Production keeps live false and the route gated.
 */

export const DEV_PRIMARY = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/finance", label: "Finance", icon: "finance" },
  { href: "/jobs", label: "Jobs", icon: "jobs" },
  { href: "/journal", label: "Journal", icon: "journal" },
  { href: "/more", label: "More", icon: "more" },
];

export const TASKS_PATH = "/tasks";

export const LIVE_PRIMARY = [
  { href: TASKS_PATH, label: "Tasks", icon: "check" },
  { href: "/grocery", label: "Grocery", icon: "groceries" },
  { href: "/finance", label: "Finance", icon: "finance" },
];

export const FINANCE_TABS = [
  { href: "/finance", label: "Overview", live: true, shipped: true },
  { href: "/finance/categories", label: "Categories", live: true, shipped: true },
  { href: "/finance/goals", label: "Goals", live: false, shipped: true },
  { href: "/finance/accounts", label: "Accounts", live: true, shipped: true },
  { href: "/finance/debts", label: "Debts", live: false, shipped: true },
  { href: "/finance/bills", label: "Bills", live: true, shipped: true },
];

const LIVE_PREFIXES = ["/tasks", "/grocery", "/finance"];
const GATED_FINANCE = ["/finance/goals", "/finance/debts"];

export function productionNav(env = process.env) {
  return env.VERCEL_ENV === "production" || env.NEXT_PUBLIC_VERCEL_ENV === "production";
}

export function primaryTabs(env = process.env) {
  return productionNav(env) ? LIVE_PRIMARY : DEV_PRIMARY;
}

export function financeTabs(env = process.env) {
  return financeTabsFor(productionNav(env));
}

export function financeTabsFor(production) {
  return FINANCE_TABS.filter((tab) => (production ? tab.live : tab.shipped));
}

/** Production Overview keeps the net-worth number unless the series is real history. */
export function showNetWorthChart(production, hasHistory) {
  return !production || hasHistory === true;
}

/** Production shows the month plan only after Joe saves the category budgets. */
export function showMonthBudget(production, month) {
  if (month == null || month.planCents == null || month.percent == null) return false;
  if (production && month.saved !== true) return false;
  return true;
}

function under(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isGatedPath(pathname) {
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
  if (GATED_FINANCE.some((prefix) => under(pathname, prefix))) return true;
  return !LIVE_PREFIXES.some((prefix) => under(pathname, prefix));
}
