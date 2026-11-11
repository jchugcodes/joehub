/** Upcoming bills. Money is integer cents. Weeks are Monday–Sunday in America/Detroit. */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const GROUPS = ["Overdue", "This week", "Later"];
const RECURRENCES = new Set(["monthly", "weekly", "yearly"]);
const CATEGORIES = new Set(["dining-out", "groceries", "transport", "subscriptions", "shopping", "utilities"]);
const LIABILITY = new Set(["credit card", "loan"]);
const STOPWORDS = new Set(["example", "the", "pos", "debit", "card", "payment", "purchase", "ach", "visa", "mastercard"]);
const BILL_ID = /^bill-[A-Za-z0-9._:-]{1,70}$/;
const CHECKING = "acct-checking";
const SNAPSHOT_AT = Date.parse("2026-11-11T11:42:00.000Z");

const CATEGORY_NAMES = {
  "dining-out": "Dining Out",
  groceries: "Groceries",
  transport: "Transport",
  subscriptions: "Subscriptions",
  shopping: "Shopping",
  utilities: "Utilities",
};

function billRecord(fields) {
  return {
    paid: false,
    paidOn: null,
    createdAt: SNAPSHOT_AT,
    updatedAt: SNAPSHOT_AT,
    ...fields,
  };
}

/** Synthetic upcoming bills. Streaming Club is the existing Nov 9 finance payment. */
export const SEED_BILLS = [
  billRecord({ id: "bill-water", name: "City Water (example)", amountCents: 4820, dueDate: "2026-11-09", recurrence: "monthly", category: "utilities", accountId: CHECKING, sort: 1 }),
  billRecord({ id: "bill-stream", name: "Streaming Club (example)", amountCents: 4675, dueDate: "2026-11-12", recurrence: "monthly", category: "subscriptions", accountId: CHECKING, paid: true, paidOn: "2026-11-09", sort: 2 }),
  billRecord({ id: "bill-phone", name: "Phone (example)", amountCents: 5500, dueDate: "2026-11-13", recurrence: "monthly", category: "subscriptions", accountId: CHECKING, sort: 3 }),
  billRecord({ id: "bill-lawn", name: "Lawn service (example)", amountCents: 4000, dueDate: "2026-11-13", recurrence: "weekly", category: null, accountId: CHECKING, sort: 4 }),
  billRecord({ id: "bill-internet", name: "Internet (example)", amountCents: 7999, dueDate: "2026-11-20", recurrence: "monthly", category: "utilities", accountId: CHECKING, sort: 5 }),
  billRecord({ id: "bill-rent", name: "Rent (example)", amountCents: 185000, dueDate: "2026-12-01", recurrence: "monthly", category: null, accountId: CHECKING, sort: 6 }),
  billRecord({ id: "bill-annual", name: "Annual membership (example)", amountCents: 9900, dueDate: "2027-01-15", recurrence: "yearly", category: "subscriptions", accountId: CHECKING, sort: 7 }),
];

export function detroitYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

function weekdayIndex(ymd) {
  const [year, month, day] = ymd.split("-").map(Number);
  let ms = Date.UTC(year, month - 1, day, 17, 0, 0);
  if (detroitYmd(ms) !== ymd) ms += detroitYmd(ms) < ymd ? 86_400_000 : -86_400_000;
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/Detroit", weekday: "short" }).format(ms);
  return WEEKDAYS.indexOf(name);
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

function weekEnd(ymd) {
  return addDays(weekStart(ymd), 6);
}

function dayNumber(ymd) {
  const [year, month, day] = ymd.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function dayDistance(left, right) {
  return Math.abs(dayNumber(left) - dayNumber(right));
}

function addMonths(ymd, count) {
  const [year, month, day] = ymd.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1 + count, 1));
  const dim = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), Math.min(day, dim))).toISOString().slice(0, 10);
}

export function nextDue(ymd, recurrence) {
  if (recurrence === "weekly") return addDays(ymd, 7);
  if (recurrence === "yearly") return addMonths(ymd, 12);
  return addMonths(ymd, 1);
}

/** A paid bill stays on its due date through that due-week, then the next occurrence becomes the row. */
export function rollBill(bill, today) {
  let next = { ...bill };
  let guard = 0;
  while (next.paid && weekEnd(next.dueDate) < today && guard < 240) {
    next = { ...next, dueDate: nextDue(next.dueDate, next.recurrence), paid: false, paidOn: null };
    guard += 1;
  }
  return next;
}

export function projectBills(bills, now = Date.now()) {
  const today = detroitYmd(now);
  let changed = false;
  const next = bills.map((bill) => {
    const rolled = rollBill(bill, today);
    if (rolled.dueDate !== bill.dueDate || rolled.paid !== bill.paid || rolled.paidOn !== bill.paidOn) changed = true;
    return rolled;
  });
  return { bills: next, changed, today };
}

export function billGroup(bill, today) {
  const start = weekStart(today);
  const end = weekEnd(today);
  if (!bill.paid && bill.dueDate < today) return "Overdue";
  if (bill.dueDate >= start && bill.dueDate <= end && (bill.dueDate >= today || bill.paid)) return "This week";
  return "Later";
}

function formatDue(ymd, today) {
  const [, month, day] = ymd.split("-").map(Number);
  const label = `${MONTHS[month - 1]} ${day}`;
  return ymd.slice(0, 4) === today.slice(0, 4) ? label : `${label}, ${ymd.slice(0, 4)}`;
}

function formatWeekday(ymd) {
  const [, month, day] = ymd.split("-").map(Number);
  const [year] = ymd.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, Number(day), 17, 0, 0);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Detroit", weekday: "short" }).format(ms);
  return `${weekday} ${MONTHS[month - 1]} ${day}`;
}

function recurrenceLabel(recurrence) {
  if (recurrence === "weekly") return "Weekly";
  if (recurrence === "yearly") return "Yearly";
  return "Monthly";
}

function dueLabel(bill, today) {
  const base = `Due ${formatDue(bill.dueDate, today)} · ${recurrenceLabel(bill.recurrence)}`;
  if (billGroup(bill, today) !== "Overdue") return base;
  const days = dayNumber(today) - dayNumber(bill.dueDate);
  return `${base} · ${days === 1 ? "1 day overdue" : `${days} days overdue`}`;
}

export function paidFromAccounts(accounts) {
  return accounts
    .filter((account) => !account.hiddenFromNetWorth && !account.closed && !LIABILITY.has(account.type))
    .map((account) => ({ id: account.id, name: account.name }));
}

function presentBill(bill, rows, accounts, today) {
  const account = accounts.find((item) => item.id === bill.accountId);
  const payments = rows
    .filter((row) => row.source === "bill" && row.billId === bill.id)
    .map((row) => ({
      id: row.id,
      date: row.date,
      amountCents: row.amountCents,
      accountId: row.accountId || null,
      accountName: accounts.find((item) => item.id === row.accountId)?.name || account?.name || "",
      label: formatWeekday(row.date),
    }))
    .sort((left, right) => right.date.localeCompare(left.date) || String(right.id).localeCompare(String(left.id)));
  const group = billGroup(bill, today);
  return {
    id: bill.id,
    name: bill.name,
    amountCents: bill.amountCents,
    dueDate: bill.dueDate,
    recurrence: bill.recurrence,
    category: bill.category,
    categoryName: bill.category ? CATEGORY_NAMES[bill.category] || "Uncategorized" : "Uncategorized",
    accountId: bill.accountId,
    accountName: account?.name || "",
    paid: Boolean(bill.paid),
    paidOn: bill.paidOn || null,
    group,
    overdueDays: group === "Overdue" ? dayNumber(today) - dayNumber(bill.dueDate) : 0,
    dueLabel: dueLabel(bill, today),
    nextDue: nextDue(bill.dueDate, bill.recurrence),
    payments,
  };
}

function sortBills(bills, today) {
  const rank = new Map(GROUPS.map((name, index) => [name, index]));
  return bills.slice().sort((left, right) => {
    const grouped = rank.get(billGroup(left, today)) - rank.get(billGroup(right, today));
    if (grouped) return grouped;
    if (left.dueDate !== right.dueDate) return left.dueDate < right.dueDate ? -1 : 1;
    return (left.sort || 0) - (right.sort || 0);
  });
}

export function billsSnapshot(bills, rows, accounts, now = Date.now()) {
  const today = detroitYmd(now);
  const shown = sortBills(bills, today).map((bill) => presentBill(bill, rows, accounts, today));
  return {
    updatedAt: new Date(now).toISOString(),
    empty: shown.length === 0,
    today,
    bills: shown,
    accounts: paidFromAccounts(accounts),
  };
}

function fail(detail, field) {
  return { ok: false, detail, field };
}

function readBill(body, accounts, fallback = {}) {
  const source = body && typeof body === "object" ? body : {};
  const name = String(source.name != null ? source.name : fallback.name || "").trim();
  if (!name) return fail("Name required.", "name");
  if (name.length > 80) return fail("Name required.", "name");
  const amount = source.amountCents != null ? source.amountCents : fallback.amountCents;
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000_000) return fail("Enter a valid amount.", "amount");
  const due = String(source.dueDate != null ? source.dueDate : fallback.dueDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return fail("Enter a valid date.", "dueDate");
  const recurrence = String(source.recurrence != null ? source.recurrence : fallback.recurrence || "");
  if (!RECURRENCES.has(recurrence)) return fail("Choose how often it repeats.", "recurrence");
  const category = source.category !== undefined ? source.category : fallback.category;
  if (category != null && !CATEGORIES.has(category)) return fail("Choose a category.", "category");
  const accountId = String(source.accountId != null ? source.accountId : fallback.accountId || "");
  const account = accounts.find((item) => item.id === accountId);
  if (!account || account.hiddenFromNetWorth || account.closed || LIABILITY.has(account.type)) return fail("Choose an account.", "accountId");
  return { ok: true, draft: { name, amountCents: amount, dueDate: due, recurrence, category: category || null, accountId } };
}

export function createBill(bills, accounts, body, now = Date.now(), seq = 1) {
  const parsed = readBill(body, accounts);
  if (!parsed.ok) return { status: 400, body: { detail: parsed.detail, field: parsed.field }, bills };
  const bill = {
    id: `bill-${now}-${seq}`,
    ...parsed.draft,
    paid: false,
    paidOn: null,
    sort: now + seq,
    createdAt: now,
    updatedAt: now,
  };
  return { status: 201, body: presentBill(bill, [], accounts, detroitYmd(now)), bills: [...bills, bill] };
}

export function patchBill(bills, rows, accounts, id, body, now = Date.now()) {
  if (!BILL_ID.test(String(id || ""))) return { status: 404, body: { detail: "That bill is not here." }, bills, rows };
  const index = bills.findIndex((bill) => bill.id === id);
  if (index < 0) return { status: 404, body: { detail: "That bill is not here." }, bills, rows };
  const current = bills[index];
  const parsed = readBill(body, accounts, current);
  if (!parsed.ok) return { status: 400, body: { detail: parsed.detail, field: parsed.field }, bills, rows };
  let nextRows = rows;
  if (current.paid && parsed.draft.dueDate !== current.dueDate) {
    nextRows = rows.map((row) => {
      if (row.source === "bill" && row.billId === current.id && row.periodDue === current.dueDate && !row.edited && !row.sourceId && !row.ledger) {
        return { ...row, periodDue: parsed.draft.dueDate, updatedAt: now };
      }
      return row;
    });
  }
  const next = { ...current, ...parsed.draft, updatedAt: now };
  const copy = bills.slice();
  copy[index] = next;
  return { status: 200, body: presentBill(next, nextRows, accounts, detroitYmd(now)), bills: copy, rows: nextRows };
}

export function deleteBill(bills, id) {
  if (!BILL_ID.test(String(id || ""))) return { status: 404, body: { detail: "That bill is not here." }, bills };
  if (!bills.some((bill) => bill.id === id)) return { status: 404, body: { detail: "That bill is not here." }, bills };
  return { status: 200, body: { deleted: true, id }, bills: bills.filter((bill) => bill.id !== id) };
}

function paymentFor(rows, bill) {
  return rows.find((row) => row.source === "bill" && row.billId === bill.id && row.periodDue === bill.dueDate) || null;
}

/**
 * Marking paid records one payment for the current due date.
 * Marking unpaid removes that payment unless Finance edited it or a ledger import linked it.
 */
export function setBillPaid(bills, rows, accounts, id, paid, now = Date.now()) {
  if (!BILL_ID.test(String(id || ""))) return { status: 404, body: { detail: "That bill is not here." }, bills, rows };
  const projected = projectBills(bills, now);
  const working = projected.bills;
  const index = working.findIndex((bill) => bill.id === id);
  if (index < 0) return { status: 404, body: { detail: "That bill is not here." }, bills, rows };
  const bill = working[index];
  const today = projected.today;
  if (paid) {
    if (bill.paid) {
      return { status: 200, body: presentBill(bill, rows, accounts, today), bills: working, rows };
    }
    const account = accounts.find((item) => item.id === bill.accountId);
    const existing = paymentFor(rows, bill);
    const payment = existing || {
      id: `fin-bill-${bill.id}-${bill.dueDate}`,
      payee: bill.name,
      date: today,
      category: bill.category,
      type: "expense",
      amountCents: -Math.abs(bill.amountCents),
      source: "bill",
      billId: bill.id,
      periodDue: bill.dueDate,
      accountId: bill.accountId,
      ...(account && typeof account.mask === "string" ? { accountMask: account.mask } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const nextRows = existing ? rows : [payment, ...rows];
    const next = { ...bill, paid: true, paidOn: today, updatedAt: now };
    const copy = working.slice();
    copy[index] = next;
    return { status: 200, body: presentBill(next, nextRows, accounts, today), bills: copy, rows: nextRows };
  }
  if (!bill.paid) {
    return { status: 200, body: presentBill(bill, rows, accounts, today), bills: working, rows };
  }
  const payment = paymentFor(rows, bill);
  if (payment && (payment.edited || payment.sourceId || payment.ledger)) {
    return { status: 409, body: { detail: "That payment was edited in Finance." }, bills: working, rows };
  }
  const nextRows = payment ? rows.filter((row) => row.id !== payment.id) : rows;
  const next = { ...bill, paid: false, paidOn: null, updatedAt: now };
  const copy = working.slice();
  copy[index] = next;
  return { status: 200, body: presentBill(next, nextRows, accounts, today), bills: copy, rows: nextRows };
}

export function merchantTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\(example\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token && !STOPWORDS.has(token));
}

/** Every bill-name token has to appear in the merchant. Extra merchant words are fine. */
export function merchantsMatch(billName, merchant) {
  const bill = merchantTokens(billName);
  const incoming = merchantTokens(merchant);
  if (!bill.length || !incoming.length) return false;
  return bill.every((token) => incoming.includes(token));
}

function sameMask(left, right) {
  return typeof left === "string" && typeof right === "string" && /^\d{4}$/.test(left) && left === right;
}

function importCandidate(row, incoming) {
  if (!row || row.source !== "bill" || row.sourceId) return false;
  if (!sameMask(row.accountMask, incoming.accountMask)) return false;
  if (row.amountCents !== incoming.amountCents) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(incoming.date || ""))) return false;
  if (dayDistance(row.date, incoming.date) > 5) return false;
  return merchantsMatch(row.payee, incoming.payee);
}

function importId(incoming, rows) {
  const raw = String(incoming.id || `fin-import-${incoming.sourceId || "row"}`).replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 80);
  const base = raw || "fin-import-row";
  if (!rows.some((row) => row.id === base)) return base;
  return `${base}-${rows.length + 1}`.slice(0, 80);
}

/**
 * Link a ledger import to an existing bill payment, or append it when nothing matches.
 * A match needs the same account mask, the exact amount, a date within five days, and a fuzzy merchant.
 * Two matches keep the payment whose date is closest. The payment gains sourceId and ledger; no second spend is inserted.
 */
export function linkOrInsertImportedTxn(rows, incoming) {
  const list = Array.isArray(rows) ? rows : [];
  const sourceId = typeof incoming?.sourceId === "string" && incoming.sourceId ? incoming.sourceId : null;
  if (sourceId) {
    const prior = list.find((row) => row.sourceId === sourceId);
    if (prior) return { linked: prior.source === "bill", rows: list, transaction: prior };
  }
  const candidates = list.filter((row) => importCandidate(row, incoming || {}));
  if (!candidates.length) {
    const transaction = {
      id: importId(incoming || {}, list),
      payee: String(incoming?.payee || "Imported"),
      date: incoming?.date,
      category: incoming?.category ?? null,
      type: incoming?.type || "expense",
      amountCents: incoming?.amountCents,
      source: "ledger",
      ...(sourceId ? { sourceId } : {}),
      ...(incoming?.accountMask ? { accountMask: incoming.accountMask } : {}),
      ...(incoming?.accountId ? { accountId: incoming.accountId } : {}),
      createdAt: incoming?.createdAt || Date.now(),
      updatedAt: incoming?.createdAt || Date.now(),
    };
    return { linked: false, rows: [transaction, ...list], transaction };
  }
  const best = candidates.slice().sort((left, right) => {
    const distance = dayDistance(left.date, incoming.date) - dayDistance(right.date, incoming.date);
    if (distance) return distance;
    return String(left.id).localeCompare(String(right.id));
  })[0];
  const transaction = {
    ...best,
    ...(sourceId ? { sourceId } : {}),
    ledger: {
      ...(best.ledger && typeof best.ledger === "object" ? best.ledger : {}),
      payee: incoming.payee,
      amountCents: incoming.amountCents,
      date: incoming.date,
      accountMask: incoming.accountMask,
      ...(sourceId ? { sourceId } : {}),
      importedAt: incoming.importedAt || `${incoming.date}T12:00:00.000Z`,
    },
    updatedAt: incoming.createdAt || best.updatedAt || Date.now(),
  };
  return {
    linked: true,
    rows: list.map((row) => (row.id === best.id ? transaction : row)),
    transaction,
  };
}

/** Import path. Callers persist `rows` and must not insert again when `linked` is true. */
export function importLedgerTransaction(rows, incoming) {
  return linkOrInsertImportedTxn(rows, incoming);
}
