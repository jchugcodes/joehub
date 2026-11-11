/**
 * Production shows only the live primary tabs and the live Finance subtabs.
 * Preview and local dev keep the full nav. Flip a Finance subtab on by setting live: true.
 * Debts stays unshipped until its page exists; then set shipped and live to true.
 */

export const DEV_PRIMARY = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/finance", label: "Finance", icon: "finance" },
  { href: "/jobs", label: "Jobs", icon: "jobs" },
  { href: "/journal", label: "Journal", icon: "journal" },
  { href: "/more", label: "More", icon: "more" },
];

export const LIVE_PRIMARY = [
  { href: "/", label: "Tasks", icon: "check" },
  { href: "/grocery", label: "Grocery", icon: "groceries" },
  { href: "/finance", label: "Finance", icon: "finance" },
];

export const FINANCE_TABS = [
  { href: "/finance", label: "Overview", live: true, shipped: true },
  { href: "/finance/categories", label: "Categories", live: true, shipped: true },
  { href: "/finance/goals", label: "Goals", live: false, shipped: true },
  { href: "/finance/accounts", label: "Accounts", live: true, shipped: true },
  { href: "/finance/debts", label: "Debts", live: false, shipped: false },
  { href: "/finance/bills", label: "Bills", live: true, shipped: true },
];

const GATED_PREFIXES = ["/jobs", "/journal", "/more", "/finance/goals", "/finance/debts"];

export function productionNav(env = process.env) {
  return env.VERCEL_ENV === "production" || env.NEXT_PUBLIC_VERCEL_ENV === "production";
}

export function primaryTabs(env = process.env) {
  return productionNav(env) ? LIVE_PRIMARY : DEV_PRIMARY;
}

export function financeTabs(env = process.env) {
  const production = productionNav(env);
  return FINANCE_TABS.filter((tab) => (production ? tab.live : tab.shipped));
}

export function isGatedPath(pathname) {
  return GATED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
