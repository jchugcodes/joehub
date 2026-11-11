/** Synthetic Finance read model. Money is integer cents. Weeks are Monday–Sunday in America/Detroit. */

import { readOptionalSourceId } from "./source-id.mjs";

export const PLAN_CENTS = 420_400;
export const NET_WORTH_CENTS = 1_847_236;
export const YTD_DELTA_CENTS = 128_410;
export const ACCOUNTS_UPDATED = "2026-11-10T14:58:00.000Z";

function categoryRecord({ slug, name, weeklyCapCents, color, sort }) {
  return { slug, name, weeklyCapCents, monthlyCapCents: null, sort, color, capCents: weeklyCapCents };
}

// Preview and local seed. Existing slugs stay put. A null weekly cap is outside the envelope.
export const SEED_CATEGORIES = [
  categoryRecord({ slug: "groceries", name: "Groceries", weeklyCapCents: 12000, color: "#2E8B6A", sort: 1 }),
  categoryRecord({ slug: "dining-out", name: "Dining Out", weeklyCapCents: 8000, color: "#E07A5F", sort: 2 }),
  categoryRecord({ slug: "transport", name: "Gas & Transport", weeklyCapCents: 6000, color: "#5B6B8C", sort: 3 }),
  categoryRecord({ slug: "utilities", name: "Bills & Utilities", weeklyCapCents: 0, color: "#3A86C8", sort: 4 }),
  categoryRecord({ slug: "subscriptions", name: "Subscriptions", weeklyCapCents: 5500, color: "#8E7CC3", sort: 5 }),
  categoryRecord({ slug: "shopping", name: "Shopping", weeklyCapCents: 7500, color: "#E9B949", sort: 6 }),
  categoryRecord({ slug: "health-fitness", name: "Health & Fitness", weeklyCapCents: null, color: "#2A9D8F", sort: 7 }),
  categoryRecord({ slug: "fun", name: "Fun", weeklyCapCents: null, color: "#C2577A", sort: 8 }),
  categoryRecord({ slug: "school", name: "School", weeklyCapCents: null, color: "#3A6EA5", sort: 9 }),
  categoryRecord({ slug: "other", name: "Other", weeklyCapCents: null, color: "#6B746E", sort: 10 }),
];

export const CATEGORIES = SEED_CATEGORIES;

const NAME_ALIASES = new Map([
  ["transport", "transport"],
  ["gas & transport", "transport"],
  ["utilities", "utilities"],
  ["bills & utilities", "utilities"],
]);

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function txn(id, payee, date, category, type, amountCents, extra = {}) {
  return {
    id,
    payee,
    date,
    category,
    type,
    amountCents,
    source: extra.source || "manual",
    createdAt: extra.createdAt,
    updatedAt: extra.updatedAt || extra.createdAt,
    ...(extra.correction ? { correction: extra.correction } : {}),
    ...(extra.ledger ? { ledger: extra.ledger } : {}),
  };
}

const T0 = 1_762_800_000_000;

export const SEED_TRANSACTIONS = [
  txn("fin-payroll", "Payroll (example)", "2026-11-09", null, "income", 235_000, { createdAt: T0 + 1, source: "ledger" }),
  txn("fin-pizza", "Joe's Pizza", "2026-11-10", "dining-out", "expense", -3240, { createdAt: T0 + 20 }),
  txn("fin-sweetgreen", "Sweetgreen", "2026-11-09", "dining-out", "expense", -2860, { createdAt: T0 + 11 }),
  txn("fin-deli", "Corner Deli", "2026-11-09", "dining-out", "expense", -2450, { createdAt: T0 + 12 }),
  txn("fin-cafe", "Cafe Norte (example)", "2026-11-10", "dining-out", "expense", -2100, { createdAt: T0 + 21 }),
  txn("fin-refund", "Example refund — Joe's Pizza", "2026-11-10", "dining-out", "refund", 1450, { createdAt: T0 + 22 }),
  txn("fin-northside", "Northside Market", "2026-11-10", "groceries", "expense", -6188, { createdAt: T0 + 23 }),
  txn("fin-trader", "Trader Joe's", "2026-11-09", "groceries", "expense", -4612, { createdAt: T0 + 13 }),
  txn("fin-bus", "City Bus pass", "2026-11-09", "transport", "expense", -2500, { createdAt: T0 + 14 }),
  txn("fin-shell", "Shell (example)", "2026-11-09", "transport", "expense", -2218, {
    createdAt: T0 + 15,
    source: "ledger",
    correction: { category: "transport", amountCents: -2218, updatedAt: T0 + 16 },
    ledger: {
      original: { payee: "Shell (example)", amountCents: -2218, category: "shopping", importedAt: "2026-11-09T13:14:00.000Z" },
    },
  }),
  txn("fin-stream", "Streaming Club (example)", "2026-11-09", "subscriptions", "expense", -4675, { createdAt: T0 + 17 }),
  txn("fin-harbor", "Harbor Supply Co.", "2026-11-10", "shopping", "expense", -1800, { createdAt: T0 + 24 }),
  txn("fin-power", "City Power (example)", "2026-11-09", "utilities", "expense", -6410, { createdAt: T0 + 18 }),
  txn("fin-vendor", "SQ *DEMO VENDOR", "2026-11-10", null, "expense", -940, { createdAt: T0 + 25 }),
  txn("fin-transfer", "Transfer to Savings (example)", "2026-11-09", null, "transfer", -20_000, { createdAt: T0 + 19 }),
  txn("fin-span-dining", "Example bistro", "2026-11-01", "dining-out", "expense", -7400, { createdAt: T0 - 80 }),
  txn("fin-span-groceries", "Example market", "2026-11-01", "groceries", "expense", -8840, { createdAt: T0 - 79 }),
  txn("fin-span-transport", "Example ride", "2026-11-01", "transport", "expense", -4000, { createdAt: T0 - 78 }),
  txn("fin-span-subs", "Example stream", "2026-11-01", "subscriptions", "expense", -4675, { createdAt: T0 - 77 }),
  txn("fin-span-shop", "Example shop", "2026-11-01", "shopping", "expense", -1200, { createdAt: T0 - 76 }),
  txn("fin-early-dining", "Example lunch counter", "2026-11-02", "dining-out", "expense", -12_000, { createdAt: T0 - 70 }),
  txn("fin-early-groceries", "Example grocery run", "2026-11-03", "groceries", "expense", -15_000, { createdAt: T0 - 69 }),
  txn("fin-early-transport", "Example fare", "2026-11-04", "transport", "expense", -8000, { createdAt: T0 - 68 }),
  txn("fin-early-shop", "Example outlet", "2026-11-05", "shopping", "expense", -7042, { createdAt: T0 - 67 }),
  txn("fin-early-power", "Example utility", "2026-11-06", "utilities", "expense", -5900, { createdAt: T0 - 66 }),
  txn("fin-old", "Example 2025 shop", "2025-01-06", "shopping", "expense", -1500, { createdAt: T0 - 500 }),
];

const RECENT_IDS = ["fin-payroll", "fin-pizza", "fin-refund", "fin-northside", "fin-trader", "fin-bus", "fin-shell", "fin-stream", "fin-harbor", "fin-power", "fin-vendor", "fin-transfer", "fin-sweetgreen", "fin-deli", "fin-cafe"];

export const ACCOUNTS = {
  netWorthCents: NET_WORTH_CENTS,
  assetsCents: 2_647_236,
  liabilitiesCents: 800_000,
  updatedAt: ACCOUNTS_UPDATED,
  accounts: [
    { name: "Example checking", group: "Cash", amountCents: 247_236 },
    { name: "Example savings", group: "Cash", amountCents: 1_000_000 },
    { name: "Example brokerage", group: "Investments", amountCents: 1_400_000 },
    { name: "Example loan", group: "Liability", amountCents: 760_000 },
    { name: "Example card", group: "Liability", amountCents: 40_000 },
  ],
};

export const GOALS = [
  { slug: "student-loan-payoff", name: "Student loan payoff", value: 62, amount: "$12,400", target: "$20,000", note: "On track" },
  { slug: "emergency-fund", name: "Emergency fund", value: 41, amount: "$4,100", target: "$10,000", note: "On track" },
  { slug: "nyc-move-fund", name: "NYC move fund", value: 28, amount: "$2,240", target: "$8,000", note: "Behind" },
  { slug: "travel-japan", name: "Travel — Japan", value: 15, amount: "$450", target: "$3,000", note: "Paused" },
];

export function detroitYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

function weekdayIndex(ymd) {
  const [year, month, day] = ymd.split("-").map(Number);
  let ms = Date.UTC(year, month - 1, day, 17, 0, 0);
  if (detroitYmd(ms) !== ymd) ms += detroitYmd(ms) < ymd ? 86_400_000 : -86_400_000;
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/Detroit", weekday: "short" }).format(ms);
  const index = WEEKDAYS.indexOf(name);
  if (index < 0) throw new Error(`weekday ${name}`);
  return index;
}

export function addDays(ymd, count) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function weekStart(ymd) {
  return addDays(ymd, -weekdayIndex(ymd));
}

export function daysLeft(today, start) {
  if (weekStart(today) !== start) return null;
  return 7 - weekdayIndex(today);
}

function monthBounds(ymd) {
  const [year, month] = ymd.split("-").map(Number);
  const start = `${ymd.slice(0, 7)}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end, days: Number(end.slice(-2)), day: Number(ymd.slice(-2)) };
}

function formatDay(ymd) {
  const month = MONTHS[Number(ymd.slice(5, 7)) - 1];
  return `${month} ${Number(ymd.slice(8))}`;
}

export function weekLabel(start, today) {
  const end = addDays(start, 6);
  const sameMonth = start.slice(5, 7) === end.slice(5, 7);
  const range = sameMonth ? `${formatDay(start)}–${Number(end.slice(8))}` : `${formatDay(start)}–${formatDay(end)}`;
  return weekStart(today) === start ? `This week · ${range}` : range;
}

export function money(cents, digits) {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const show = digits == null ? abs % 100 !== 0 : digits;
  const text = show ? (abs / 100).toFixed(2) : String(Math.round(abs / 100));
  const [whole, frac] = text.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${frac ? `${grouped}.${frac}` : grouped}`;
}

export function effective(row) {
  const correction = row.correction || null;
  const latest = !correction && row.ledger && row.ledger.latest ? row.ledger.latest : null;
  const overlay = correction || latest || {};
  return {
    ...row,
    payee: overlay.payee || row.payee,
    amountCents: overlay.amountCents ?? row.amountCents,
    category: Object.prototype.hasOwnProperty.call(overlay, "category") ? overlay.category : row.category,
    type: overlay.type || row.type,
    date: overlay.date || row.date,
    corrected: Boolean(correction),
  };
}

export function countsAsSpend(row) {
  return row.type === "expense" || row.type === "refund";
}

export function spendCents(row) {
  if (!countsAsSpend(row)) return 0;
  return -row.amountCents;
}

function categoryBySlug(slug) {
  return CATEGORIES.find((item) => item.slug === slug) || null;
}

function categoryByName(name) {
  const needle = String(name || "").trim().toLowerCase();
  const alias = NAME_ALIASES.get(needle);
  if (alias) return categoryBySlug(alias);
  return CATEGORIES.find((item) => item.name.toLowerCase() === needle) || null;
}

export function envelopeTotal(categories = CATEGORIES) {
  return categories.reduce((sum, item) => (Number.isInteger(item.weeklyCapCents) ? sum + item.weeklyCapCents : sum), 0);
}

export function categoriesFromCaps(caps, base = SEED_CATEGORIES) {
  const source = caps && typeof caps === "object" && !Array.isArray(caps) ? caps : {};
  return base.map((category) => {
    if (!Object.prototype.hasOwnProperty.call(source, category.slug) || !Number.isInteger(source[category.slug])) return { ...category };
    return { ...category, weeklyCapCents: source[category.slug], capCents: source[category.slug] };
  });
}

export function normalizeCategories(stored, caps) {
  const rows = Array.isArray(stored) ? stored.map(storedCategory).filter(Boolean) : [];
  const base = rows.length ? rows : SEED_CATEGORIES.map((category) => ({ ...category }));
  const known = new Set(base.map((category) => category.slug));
  const categories = [...base, ...SEED_CATEGORIES.filter((category) => !known.has(category.slug)).map((category) => ({ ...category }))];
  return categoriesFromCaps(caps, categories);
}

function storedCategory(raw) {
  if (!raw || typeof raw.slug !== "string" || typeof raw.name !== "string") return null;
  const weeklyCapCents = raw.weeklyCapCents == null ? null : raw.weeklyCapCents;
  if (weeklyCapCents != null && !Number.isInteger(weeklyCapCents)) return null;
  const monthlyCapCents = raw.monthlyCapCents == null ? null : raw.monthlyCapCents;
  if (monthlyCapCents != null && !Number.isInteger(monthlyCapCents)) return null;
  const category = {
    slug: raw.slug,
    name: raw.name,
    weeklyCapCents,
    monthlyCapCents,
    sort: Number.isInteger(raw.sort) ? raw.sort : 100,
    color: typeof raw.color === "string" ? raw.color : "#6B746E",
    capCents: weeklyCapCents,
  };
  if (typeof raw.group === "string" && raw.group.trim()) category.group = raw.group.trim();
  return category;
}

export function publicCategories(categories) {
  return categories
    .map((category) => {
      const row = {
        slug: category.slug,
        name: category.name,
        weeklyCapCents: Number.isInteger(category.weeklyCapCents) ? category.weeklyCapCents : null,
        monthlyCapCents: Number.isInteger(category.monthlyCapCents) ? category.monthlyCapCents : null,
        sort: category.sort,
      };
      if (category.group) row.group = category.group;
      if (category.color) row.color = category.color;
      return row;
    })
    .sort((left, right) => left.sort - right.sort || (left.slug < right.slug ? -1 : 1));
}

export function resolveCategory(value) {
  if (!value) return null;
  return categoryBySlug(value) || categoryByName(value);
}

function capState(spent, cap) {
  if (!cap) {
    return { state: "none", percent: null, fill: 0, tone: "muted", status: "No cap set" };
  }
  const ratio = spent / cap;
  const percent = Math.round(ratio * 100);
  const fill = Math.min(100, Math.max(0, percent));
  if (ratio > 1) {
    return { state: "over", percent, fill: 100, tone: "over", status: `${money(spent - cap)} over` };
  }
  if (ratio > 0.85) {
    return { state: "near", percent, fill, tone: "over", status: `${money(cap - spent)} left` };
  }
  return { state: "under", percent, fill, tone: "category", status: `${money(cap - spent)} left` };
}

function rowsInWeek(txns, start) {
  const end = addDays(start, 6);
  return txns.map(effective).filter((row) => row.date >= start && row.date <= end);
}

function spentFor(rows, slug) {
  return rows.reduce((sum, row) => (row.category === slug ? sum + spendCents(row) : sum), 0);
}

export function defaultCaps(categories = CATEGORIES) {
  return Object.fromEntries(categories.filter((item) => Number.isInteger(item.weeklyCapCents)).map((item) => [item.slug, item.weeklyCapCents]));
}

export const ENVELOPE_CENTS = envelopeTotal();

function envelopeSlugs(current, categories) {
  const slugs = new Set(Object.keys(current || {}));
  return categories.filter((category) => slugs.has(category.slug)).sort((left, right) => left.sort - right.sort);
}

export function parseCaps(input, current = defaultCaps(), categories = CATEGORIES) {
  const listed = envelopeSlugs(current, categories);
  const first = listed[0] || categories[0];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, field: first.slug, detail: "Enter an amount." };
  }
  const caps = {};
  for (const category of listed) {
    if (!Object.prototype.hasOwnProperty.call(input, category.slug)) {
      return { ok: false, field: category.slug, detail: "Enter an amount." };
    }
    const raw = input[category.slug];
    if (raw === "" || raw == null) {
      caps[category.slug] = 0;
      continue;
    }
    if (typeof raw !== "number" || !Number.isInteger(raw)) {
      return { ok: false, field: category.slug, detail: "Enter an amount." };
    }
    if (raw < 0) return { ok: false, field: category.slug, detail: "Can’t be negative." };
    caps[category.slug] = raw;
  }
  const total = Object.values(caps).reduce((sum, value) => sum + value, 0);
  const target = Object.values(current).reduce((sum, value) => sum + value, 0);
  if (total !== target) {
    const increased = listed.find((item) => caps[item.slug] > (current[item.slug] || 0));
    const changed = listed.find((item) => caps[item.slug] !== (current[item.slug] || 0));
    return { ok: false, field: (increased || changed || first).slug, detail: `That total has to stay ${money(target)}.` };
  }
  return { ok: true, caps };
}

export function capsForWeek(txns, start, caps = defaultCaps(), categories = CATEGORIES) {
  const rows = rowsInWeek(txns, start);
  return [...categories]
    .sort((left, right) => left.sort - right.sort)
    .map((category) => {
      const hasCap = Object.prototype.hasOwnProperty.call(caps, category.slug);
      const weeklyCapCents = hasCap ? caps[category.slug] : category.weeklyCapCents;
      const inEnvelope = Number.isInteger(weeklyCapCents);
      const spent = spentFor(rows, category.slug);
      const state = capState(spent, inEnvelope ? weeklyCapCents : 0);
      return {
        slug: category.slug,
        name: category.name,
        color: category.color,
        spentCents: spent,
        capCents: inEnvelope ? weeklyCapCents : null,
        weeklyCapCents: inEnvelope ? weeklyCapCents : null,
        inEnvelope,
        ...state,
      };
    });
}

const YTD_Y = [116, 102.8, 109.4, 89.6, 94.9, 79.1, 76.5, 84.4, 64.6, 56.7, 62, 42.2, 34.3, 39.6, 23.8, 18.5, 4];

function ytdPoints() {
  const start = NET_WORTH_CENTS - YTD_DELTA_CENTS;
  return YTD_Y.map((y, index) => {
    if (index === 0) return start;
    if (index === YTD_Y.length - 1) return NET_WORTH_CENTS;
    const span = YTD_Y[0] - YTD_Y[YTD_Y.length - 1];
    return Math.round(start + ((YTD_Y[0] - y) / span) * (NET_WORTH_CENTS - start));
  });
}

export function seedSnapshots() {
  return {
    netWorthCents: NET_WORTH_CENTS,
    ytdDeltaCents: YTD_DELTA_CENTS,
    caption: `+${money(YTD_DELTA_CENTS)} (7.5%) YTD`,
    points: ytdPoints(),
  };
}

function weeklySeries(txns, from, to) {
  const weeks = new Map();
  for (const row of txns.map(effective)) {
    const start = weekStart(row.date);
    if (from && start < from) continue;
    if (to && start > to) continue;
    weeks.set(start, (weeks.get(start) || 0) + spendCents(row));
  }
  return [...weeks.keys()].sort().map((week) => ({ week, cents: weeks.get(week) }));
}

export function chartFor(txns, today, range, snapshot) {
  const current = weekStart(today);
  if (range === "YTD") {
    const seeded = snapshot || seedSnapshots();
    return { range, kind: "net-worth", caption: seeded.caption, points: seeded.points };
  }
  let from = null;
  if (range === "1W") from = current;
  if (range === "1M") from = weekStart(monthBounds(today).start);
  if (range === "1Y") from = weekStart(addDays(today, -365));
  const points = weeklySeries(txns, from, current);
  return { range, kind: "weekly", caption: "", points: points.map((point) => point.cents) };
}

export function monthProgress(txns, today, planCents = PLAN_CENTS) {
  const month = monthBounds(today);
  const spent = txns
    .map(effective)
    .filter((row) => row.date >= month.start && row.date <= today)
    .reduce((sum, row) => sum + spendCents(row), 0);
  return {
    label: `${formatDay(month.start)}–${Number(today.slice(8))}`,
    spentCents: spent,
    planCents,
    percent: Math.round((spent / planCents) * 100),
    day: month.day,
    days: month.days,
  };
}

function dateLabel(ymd) {
  return `${WEEKDAYS[weekdayIndex(ymd)]} ${formatDay(ymd)}`;
}

function recentMeta(row) {
  if (row.type === "income") return `${dateLabel(row.date)} · Income`;
  if (row.type === "transfer") return `${dateLabel(row.date)} · Transfer`;
  if (row.type === "refund") return `${dateLabel(row.date)} · ${categoryBySlug(row.category)?.name || "Refund"}`;
  if (!row.category) return `${dateLabel(row.date)} · Uncategorized`;
  return `${dateLabel(row.date)} · ${categoryBySlug(row.category)?.name || row.category}`;
}

export function overview(txns, now, week, range, caps = defaultCaps(), context = {}) {
  const today = detroitYmd(now);
  const start = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStart(week) : weekStart(today);
  if (start > weekStart(today)) {
    return { status: 400, body: { detail: "That week has not started.", field: "week" } };
  }
  const chosen = ["1W", "1M", "YTD", "1Y", "All"].includes(range) ? range : "YTD";
  const planCents = context.planCents ?? PLAN_CENTS;
  const snapshot = context.snapshot || seedSnapshots();
  const rows = rowsInWeek(txns, start);
  const order = new Map(RECENT_IDS.map((id, index) => [id, index]));
  const recent = [...rows].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99) || (a.date < b.date ? 1 : -1));
  return {
    status: 200,
    body: {
      asOf: today,
      weekStart: start,
      weekEnd: addDays(start, 6),
      label: weekLabel(start, today),
      current: start === weekStart(today),
      daysLeft: daysLeft(today, start),
      previousWeek: addDays(start, -7),
      nextWeek: start === weekStart(today) ? null : addDays(start, 7),
      netWorthCents: snapshot.netWorthCents,
      chart: chartFor(txns, today, chosen, snapshot),
      month: monthProgress(txns, today, planCents),
      caps: capsForWeek(txns, start, caps, context.categories || CATEGORIES),
      recent: recent.map((row) => ({
        id: row.id,
        payee: row.payee,
        amountCents: row.amountCents,
        meta: recentMeta(row),
        corrected: row.corrected,
        category: row.category,
        type: row.type,
      })),
      empty: rows.length === 0,
    },
  };
}

function resolveIn(categories, value) {
  if (!value) return null;
  const list = categories && categories.length ? categories : CATEGORIES;
  const bySlug = list.find((item) => item.slug === value);
  if (bySlug) return bySlug;
  const needle = String(value).trim().toLowerCase();
  return list.find((item) => item.name.toLowerCase() === needle) || resolveCategory(value);
}

export function categoryView(txns, now, week, categoryValue, caps = defaultCaps(), categories = CATEGORIES) {
  const category = resolveIn(categories, categoryValue);
  if (!category) return { status: 404, body: { detail: "That category is not here." } };
  const today = detroitYmd(now);
  const start = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStart(week) : weekStart(today);
  if (start > weekStart(today)) return { status: 400, body: { detail: "That week has not started.", field: "week" } };
  const rows = rowsInWeek(txns, start).filter((row) => row.category === category.slug);
  const spent = rows.reduce((sum, row) => sum + spendCents(row), 0);
  const hasCap = Object.prototype.hasOwnProperty.call(caps, category.slug);
  const weeklyCapCents = hasCap ? caps[category.slug] : category.weeklyCapCents;
  const inEnvelope = Number.isInteger(weeklyCapCents);
  const capCents = inEnvelope ? weeklyCapCents : null;
  const state = capState(spent, inEnvelope ? weeklyCapCents : 0);
  return {
    status: 200,
    body: {
      ...category,
      capCents,
      spentCents: spent,
      ...state,
      weekStart: start,
      label: weekLabel(start, today),
      daysLeft: daysLeft(today, start),
      rows: rows.map((row) => ({
        id: row.id,
        payee: row.payee,
        amountCents: row.amountCents,
        meta: `${dateLabel(row.date)} · ${category.name}`,
        corrected: row.corrected,
      })),
    },
  };
}

const TXN_TYPES = new Set(["expense", "income", "transfer", "refund"]);

function cleanPayee(value) {
  const payee = String(value || "").trim().replace(/\s+/g, " ");
  return payee.length >= 1 && payee.length <= 80 ? payee : "";
}

function cleanDate(value) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T12:00:00-05:00`);
  return Number.isNaN(parsed.getTime()) || detroitYmd(parsed.getTime()) !== date ? "" : date;
}

function signedAmount(type, cents) {
  if (!Number.isInteger(cents) || cents === 0 || Math.abs(cents) > 100_000_000) return null;
  return type === "income" || type === "refund" ? Math.abs(cents) : -Math.abs(cents);
}

export function presentTransaction(row) {
  const shown = effective(row);
  return {
    id: shown.id,
    payee: shown.payee,
    amountCents: shown.amountCents,
    date: shown.date,
    category: shown.category,
    type: shown.type,
    source: row.source || "manual",
    meta: recentMeta(shown),
    corrected: shown.corrected,
    uncategorized: shown.type === "expense" && !shown.category,
    original: row.ledger && row.ledger.original ? row.ledger.original : null,
    latest: row.ledger && row.ledger.latest ? row.ledger.latest : null,
    correction: row.correction ? { amountCents: row.correction.amountCents, category: row.correction.category ?? null, payee: row.correction.payee || row.payee } : null,
    ...(shown.sourceId ? { sourceId: shown.sourceId } : {}),
    ...(shown.accountMask ? { accountMask: shown.accountMask } : {}),
    ...(typeof shown.impulse === "boolean" ? { impulse: shown.impulse } : {}),
  };
}

export function transactionsForWeek(rows, now = Date.now(), week = "") {
  const today = detroitYmd(now);
  const start = week && week.length === 10 ? weekStart(week) : weekStart(today);
  if (start > weekStart(today)) return { status: 400, body: { detail: "That week has not started.", field: "week" } };
  return {
    status: 200,
    body: {
      weekStart: start,
      label: weekLabel(start, today),
      daysLeft: daysLeft(today, start),
      today,
      previousWeek: addDays(start, -7),
      nextWeek: addDays(start, 7) <= weekStart(today) ? addDays(start, 7) : null,
      rows: rowsInWeek(rows, start).map((row) => presentTransaction(rows.find((item) => item.id === row.id) || row)),
    },
  };
}

function readDraft(body, shown = {}, categories = CATEGORIES) {
  const type = String((body && body.type) || shown.type || "");
  if (!TXN_TYPES.has(type)) return { ok: false, detail: "Choose a type.", field: "type" };
  const payee = cleanPayee(body && "payee" in body ? body.payee : shown.payee);
  if (!payee) return { ok: false, detail: "Enter a name.", field: "payee" };
  const date = cleanDate(body && "date" in body ? body.date : shown.date);
  if (!date) return { ok: false, detail: "Enter a date.", field: "date" };
  const rawAmount = body && "amountCents" in body ? body.amountCents : shown.amountCents;
  const amountCents = signedAmount(type, rawAmount);
  if (amountCents == null) return { ok: false, detail: "Enter an amount.", field: "amount" };
  let category = type === "transfer" || type === "income" ? null : body && "category" in body ? body.category : shown.category;
  if (category === "" || category == null) category = null;
  else {
    const resolved = resolveIn(categories, category);
    if (!resolved) return { ok: false, detail: "Choose a category.", field: "category" };
    category = resolved.slug;
  }
  const source = readOptionalSourceId(body, shown);
  if (!source.ok) return source;
  const mask = readAccountMask(body, shown);
  if (!mask.ok) return mask;
  const impulse = readImpulse(body, shown);
  if (!impulse.ok) return impulse;
  return { ok: true, draft: { payee, date, type, amountCents, category, sourceId: source.sourceId, accountMask: mask.accountMask, impulse: impulse.impulse } };
}

function readAccountMask(body, shown) {
  if (!(body && Object.prototype.hasOwnProperty.call(body, "accountMask"))) {
    return { ok: true, accountMask: shown.accountMask || "" };
  }
  if (body.accountMask == null || body.accountMask === "") return { ok: true, accountMask: "" };
  const accountMask = String(body.accountMask);
  if (!/^\d{4}$/.test(accountMask)) return { ok: false, field: "accountMask", detail: "Use the last 4 digits." };
  return { ok: true, accountMask };
}

function readImpulse(body, shown) {
  if (!(body && Object.prototype.hasOwnProperty.call(body, "impulse"))) {
    return { ok: true, impulse: typeof shown.impulse === "boolean" ? shown.impulse : null };
  }
  if (body.impulse == null || body.impulse === "") return { ok: true, impulse: null };
  if (typeof body.impulse !== "boolean") return { ok: false, field: "impulse", detail: "Choose yes or no." };
  return { ok: true, impulse: body.impulse };
}

function withRowMeta(row, { sourceId, accountMask, impulse }) {
  const next = { ...row };
  if (sourceId) next.sourceId = sourceId;
  else delete next.sourceId;
  if (accountMask) next.accountMask = accountMask;
  else delete next.accountMask;
  if (typeof impulse === "boolean") next.impulse = impulse;
  else delete next.impulse;
  return next;
}

export function createTransaction(rows, body, now = Date.now(), seq = 1, categories = CATEGORIES) {
  const parsed = readDraft(body, { type: "expense", category: null, amountCents: 0 }, categories);
  if (!parsed.ok) return { status: 400, body: { detail: parsed.detail, field: parsed.field }, rows };
  const { sourceId, accountMask, impulse, ...fields } = parsed.draft;
  const row = withRowMeta(
    {
      id: `fin-manual-${now}-${seq}`,
      source: "manual",
      createdAt: now,
      ...fields,
    },
    { sourceId, accountMask, impulse },
  );
  return { status: 201, body: presentTransaction(row), rows: [row, ...rows] };
}

export function patchTransaction(rows, id, body, now = Date.now(), categories = CATEGORIES) {
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return { status: 404, body: { detail: "That transaction is not here." }, rows };
  const current = rows[index];
  const parsed = readDraft(body, effective(current), categories);
  if (!parsed.ok) return { status: 400, body: { detail: parsed.detail, field: parsed.field }, rows };
  const { sourceId, accountMask, impulse, ...fields } = parsed.draft;
  const edited = current.source === "ledger" ? { ...current, correction: { ...fields, updatedAt: now } } : { ...current, ...fields, updatedAt: now };
  const next = withRowMeta(edited, { sourceId, accountMask, impulse });
  const copy = rows.slice();
  copy[index] = next;
  return { status: 200, body: presentTransaction(next), rows: copy };
}

export function simulateLedgerRefresh(rows, now = Date.now()) {
  return rows.map((row) => {
    if (row.id !== "fin-shell" || row.source !== "ledger") return row;
    return {
      ...row,
      ledger: {
        ...(row.ledger || {}),
        latest: { payee: row.payee, amountCents: -2418, category: "shopping", importedAt: new Date(now).toISOString() },
      },
    };
  });
}

export function resetLedger(rows, id) {
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return { status: 404, body: { detail: "That transaction is not here." }, rows };
  const current = rows[index];
  if (current.source !== "ledger") return { status: 400, body: { detail: "That row was entered here." }, rows };
  if (!current.correction) return { status: 400, body: { detail: "There is no correction to reset." }, rows };
  const next = { ...current };
  delete next.correction;
  const copy = rows.slice();
  copy[index] = next;
  return { status: 200, body: presentTransaction(next), rows: copy };
}

export function publicTransactions(txns) {
  return txns.map((row) => {
    const shown = effective(row);
    return {
      id: shown.id,
      payee: shown.payee,
      amountCents: shown.amountCents,
      date: shown.date,
      category: shown.category,
      type: shown.type,
      corrected: shown.corrected,
    };
  });
}

export function installMemoryFinance(store, txns = SEED_TRANSACTIONS) {
  let rows = txns.map((row) => structuredClone(row));
  let seq = 0;
  let caps = defaultCaps();
  const idem = new Map();
  const planCents = PLAN_CENTS;
  const snapshot = seedSnapshots();
  const accounts = structuredClone(ACCOUNTS);
  const goals = structuredClone(GOALS);
  const context = () => ({ planCents, snapshot, netWorthCents: snapshot.netWorthCents });
  store.financeOverview = (now, week, range) => overview(rows, now, week, range, caps, context());
  store.financeCategory = (now, week, category) => categoryView(rows, now, week, category, caps);
  store.financeAccounts = async () => structuredClone(accounts);
  store.financeGoals = async () => structuredClone(goals);
  store.financeTransactions = async (now = Date.now(), week = "") => transactionsForWeek(rows, now, week);
  store.financeTransaction = async (id) => {
    const row = rows.find((item) => item.id === id);
    return row ? { status: 200, body: presentTransaction(row) } : { status: 404, body: { detail: "That transaction is not here." } };
  };
  store.financeCreateTransaction = async (body, now = Date.now(), key = "") => {
    if (key && idem.has(`create:${key}`)) return idem.get(`create:${key}`);
    seq += 1;
    const result = createTransaction(rows, body, now, seq);
    if (result.status === 201) rows = result.rows;
    const stored = { status: result.status, body: result.body };
    if (key && result.status === 201) idem.set(`create:${key}`, stored);
    return stored;
  };
  store.financePatchTransaction = async (id, body, now = Date.now()) => {
    const result = patchTransaction(rows, id, body, now);
    if (result.status === 200) rows = result.rows;
    return { status: result.status, body: result.body };
  };
  store.financeSimulateRefresh = async (now = Date.now()) => {
    rows = simulateLedgerRefresh(rows, now);
    const shell = rows.find((row) => row.id === "fin-shell");
    return { status: 200, body: shell ? presentTransaction(shell) : { ok: true } };
  };
  store.financeResetLedger = async (id) => {
    const result = resetLedger(rows, id);
    if (result.status === 200) rows = result.rows;
    return { status: result.status, body: result.body };
  };
  store.financeCaps = async () => ({ caps: { ...caps }, envelopeCents: ENVELOPE_CENTS });
  store.financeSaveCaps = async (body, key) => {
    if (key && idem.has(key)) return idem.get(key);
    const parsed = parseCaps(body && body.caps, caps);
    if (!parsed.ok) return { status: 400, body: { detail: parsed.detail, field: parsed.field } };
    caps = parsed.caps;
    const result = { status: 200, body: { caps: { ...caps }, envelopeCents: ENVELOPE_CENTS } };
    if (key) idem.set(key, result);
    return result;
  };
  return store;
}
