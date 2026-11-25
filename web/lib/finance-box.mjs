import { createHash } from "node:crypto";
import { SEED_BILLS, billsSnapshot, projectBills } from "./bills.mjs";
import {
  ACCOUNTS,
  GOALS,
  PLAN_CENTS,
  SEED_ACCOUNT_LINKS,
  SEED_ACCOUNTS,
  SEED_TRANSACTIONS,
  categoriesFromCaps,
  categoryView,
  debtById,
  debtsSnapshot,
  defaultCaps,
  goalStatus,
  normalizeCategories,
  overview,
  presentAccount,
  presentTransaction,
  publicCategories,
  rollUpAccounts,
  seedSnapshots,
  spendingMonth,
  transactionsForWeek,
  accountsSnapshot,
  bucketsSnapshot,
  categoriesSnapshot,
} from "./finance.mjs";
import { StoreError } from "./store-upstash.mjs";

export const UNASSIGNED_WEB_ID = "acct-unassigned";
const BUDGET_START = "2026-01-01";
const WRITER = "system";
const ACCOUNT_ID = /^acct-[A-Za-z0-9._:-]{1,70}$/;
const TXN_ID = /^[A-Za-z0-9._:-]{1,80}$/;

export function boxUuid(entity, webId) {
  const hex = createHash("sha256").update(`joehub-finance:${entity}:${webId}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function boxAccountType(type) {
  if (type === "checking" || type === "savings" || type === "cash") return type;
  if (type === "credit card") return "credit";
  if (type === "investment" || type === "retirement" || type === "brokerage" || type === "crypto") return "investment";
  return "other";
}

export function boxGoalStatus(goal) {
  const status = goalStatus(goal);
  if (status === "inactive" || status === "paused") return "paused";
  if (status === "not_started" || status === "active") return "active";
  return "active";
}

export function financeScore(row) {
  const day = Number(String(row.date || "").replaceAll("-", ""));
  const created = Number(row.createdAt) || 0;
  return day * 1_000_000 + (created % 1_000_000);
}

function stamp(ms) {
  const iso = Number.isInteger(ms) ? new Date(ms).toISOString() : "2026-01-01T00:00:00.000Z";
  return iso.replace(/\.\d{3}Z$/, "Z");
}

function seededTransactions() {
  const rows = SEED_TRANSACTIONS.map((row) => structuredClone(row));
  for (const link of SEED_ACCOUNT_LINKS) {
    const row = rows.find((item) => item.id === link.id);
    if (row && !row.accountId) row.accountId = link.accountId;
  }
  const stream = rows.find((row) => row.id === "fin-stream");
  if (stream && !stream.billId) {
    stream.source = "bill";
    stream.billId = "bill-stream";
    stream.periodDue = "2026-11-12";
    stream.accountId = stream.accountId || "acct-checking";
    stream.accountMask = stream.accountMask || "3816";
  }
  if (!rows.some((row) => row.id === "fin-water")) {
    const water = SEED_TRANSACTIONS.find((row) => row.id === "fin-water");
    if (water) rows.push(structuredClone(water));
  }
  return rows;
}

export function seedBundle() {
  const caps = defaultCaps();
  const full = categoriesFromCaps(caps);
  return {
    transactions: seededTransactions(),
    categories: publicCategories(full),
    fullCategories: full,
    caps,
    plan: { cents: PLAN_CENTS },
    snapshot: seedSnapshots(),
    legacyAccounts: structuredClone(ACCOUNTS),
    goals: structuredClone(GOALS),
    accounts: structuredClone(SEED_ACCOUNTS),
    bills: structuredClone(SEED_BILLS),
  };
}

async function exec(db, sql, args = []) {
  return db.execute({ sql, args });
}

async function clearFinance(db) {
  await exec(db, "DELETE FROM transactions");
  await exec(db, "DELETE FROM budgets");
  await exec(db, "DELETE FROM goals");
  await exec(db, "DELETE FROM finance_goal_status");
  await exec(db, "DELETE FROM accounts");
  await exec(db, "DELETE FROM categories");
  await exec(db, "DELETE FROM finance_docs");
  await exec(db, "DELETE FROM finance_ids");
  await exec(db, "DELETE FROM finance_blobs");
  await exec(db, "DELETE FROM finance_sources");
}

function categoryRows(bundle) {
  const rows = Array.isArray(bundle.fullCategories) && bundle.fullCategories.length
    ? bundle.fullCategories
    : normalizeCategories(bundle.categories, bundle.categories ? null : bundle.caps);
  return rows.filter((row) => row && row.removed !== true);
}

export async function writeFinanceBundle(db, bundle) {
  await clearFinance(db);
  const categories = categoryRows(bundle);
  const categoryBox = new Map();
  for (const category of categories) {
    const boxId = boxUuid("category", category.slug);
    categoryBox.set(category.slug, boxId);
    await exec(
      db,
      `INSERT INTO categories (
         id, notion_id, migrated_on, last_modified_by, last_modified_at, name, kind
       ) VALUES (?, NULL, NULL, ?, ?, ?, 'expense')`,
      [boxId, WRITER, stamp(null), category.name],
    );
    await exec(db, "INSERT INTO finance_ids (entity, web_id, box_id) VALUES ('category', ?, ?)", [category.slug, boxId]);
    if (Number.isInteger(category.weeklyCapCents)) {
      const budgetId = boxUuid("budget", `${category.slug}:weekly`);
      await exec(
        db,
        `INSERT INTO budgets (
           id, notion_id, migrated_on, last_modified_by, last_modified_at, name, category_id, account_id,
           period, amount_cents, start_date, end_date
         ) VALUES (?, NULL, NULL, ?, ?, ?, ?, NULL, 'weekly', CAST(? AS INTEGER), ?, NULL)`,
        [budgetId, WRITER, stamp(null), category.name, boxId, category.weeklyCapCents, BUDGET_START],
      );
      await exec(db, "INSERT INTO finance_ids (entity, web_id, box_id) VALUES ('budget', ?, ?)", [`${category.slug}:weekly`, budgetId]);
    }
    if (Number.isInteger(category.monthlyCapCents)) {
      const budgetId = boxUuid("budget", `${category.slug}:monthly`);
      await exec(
        db,
        `INSERT INTO budgets (
           id, notion_id, migrated_on, last_modified_by, last_modified_at, name, category_id, account_id,
           period, amount_cents, start_date, end_date
         ) VALUES (?, NULL, NULL, ?, ?, ?, ?, NULL, 'monthly', CAST(? AS INTEGER), ?, NULL)`,
        [budgetId, WRITER, stamp(null), category.name, boxId, category.monthlyCapCents, BUDGET_START],
      );
      await exec(db, "INSERT INTO finance_ids (entity, web_id, box_id) VALUES ('budget', ?, ?)", [`${category.slug}:monthly`, budgetId]);
    }
  }

  const accountBox = new Map();
  const unassigned = boxUuid("account", UNASSIGNED_WEB_ID);
  accountBox.set(UNASSIGNED_WEB_ID, unassigned);
  await exec(
    db,
    `INSERT INTO accounts (
       id, notion_id, migrated_on, last_modified_by, last_modified_at, name, account_type, institution, currency
     ) VALUES (?, NULL, NULL, ?, ?, 'Unassigned', 'other', NULL, 'USD')`,
    [unassigned, WRITER, stamp(null)],
  );
  await exec(db, "INSERT INTO finance_ids (entity, web_id, box_id) VALUES ('account', ?, ?)", [UNASSIGNED_WEB_ID, unassigned]);

  for (const account of bundle.accounts || []) {
    const boxId = boxUuid("account", account.id);
    accountBox.set(account.id, boxId);
    const institution = typeof account.institution === "string" && account.institution.trim() ? account.institution.trim() : null;
    await exec(
      db,
      `INSERT INTO accounts (
         id, notion_id, migrated_on, last_modified_by, last_modified_at, name, account_type, institution, currency
       ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, 'USD')`,
      [boxId, WRITER, stamp(account.updatedAt || account.createdAt), account.name, boxAccountType(account.type), institution],
    );
    await exec(db, "INSERT INTO finance_ids (entity, web_id, box_id) VALUES ('account', ?, ?)", [account.id, boxId]);
    await exec(db, "INSERT INTO finance_docs (entity, web_id, body, sort_key) VALUES ('account', ?, ?, ?)", [
      account.id,
      JSON.stringify(account),
      Number(account.createdAt) || 0,
    ]);
  }

  const accountsByName = new Map((bundle.accounts || []).map((account) => [account.name, account.id]));
  for (const goal of bundle.goals || []) {
    const boxId = boxUuid("goal", goal.slug);
    const linked = goal.account ? accountBox.get(accountsByName.get(goal.account) || "") || null : null;
    const targetDate = typeof goal.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(goal.targetDate) ? goal.targetDate : null;
    await exec(
      db,
      `INSERT INTO goals (
         id, notion_id, migrated_on, last_modified_by, last_modified_at, name, target_cents, current_cents,
         target_date, account_id, status
       ) VALUES (?, NULL, NULL, ?, ?, ?, CAST(? AS INTEGER), CAST(? AS INTEGER), ?, ?, ?)`,
      [
        boxId,
        WRITER,
        stamp(null),
        goal.name,
        Number.isInteger(goal.targetCents) ? goal.targetCents : 0,
        Number.isInteger(goal.savedCents) ? goal.savedCents : 0,
        targetDate,
        linked,
        boxGoalStatus(goal),
      ],
    );
    await exec(db, "INSERT INTO finance_ids (entity, web_id, box_id) VALUES ('goal', ?, ?)", [goal.slug, boxId]);
    await exec(db, "INSERT INTO finance_goal_status (box_id, status) VALUES (?, ?)", [boxId, goalStatus(goal)]);
  }

  for (const row of bundle.transactions || []) {
    const boxId = boxUuid("transaction", row.id);
    const accountId = (row.accountId && accountBox.get(row.accountId)) || unassigned;
    const categoryId = row.category ? categoryBox.get(row.category) || null : null;
    await exec(
      db,
      `INSERT INTO transactions (
         id, notion_id, migrated_on, last_modified_by, last_modified_at, account_id, category_id, goal_id,
         amount_cents, date, payee, memo
       ) VALUES (?, NULL, NULL, ?, ?, ?, ?, NULL, CAST(? AS INTEGER), ?, ?, ?)`,
      [boxId, WRITER, stamp(row.updatedAt || row.createdAt), accountId, categoryId, row.amountCents, row.date, row.payee || null, typeof row.note === "string" && row.note ? row.note : null],
    );
    await exec(db, "INSERT INTO finance_ids (entity, web_id, box_id) VALUES ('transaction', ?, ?)", [row.id, boxId]);
    await exec(db, "INSERT INTO finance_docs (entity, web_id, body, sort_key) VALUES ('transaction', ?, ?, ?)", [
      row.id,
      JSON.stringify(row),
      financeScore(row),
    ]);
    if (typeof row.sourceId === "string" && row.sourceId) {
      await exec(
        db,
        `INSERT INTO finance_sources (source_id, web_id) VALUES (?, ?)
         ON CONFLICT(source_id) DO UPDATE SET web_id = excluded.web_id`,
        [row.sourceId, row.id],
      );
    }
  }

  for (const bill of bundle.bills || []) {
    const boxId = boxUuid("bill", bill.id);
    await exec(db, "INSERT INTO finance_ids (entity, web_id, box_id) VALUES ('bill', ?, ?)", [bill.id, boxId]);
    await exec(db, "INSERT INTO finance_docs (entity, web_id, body, sort_key) VALUES ('bill', ?, ?, ?)", [
      bill.id,
      JSON.stringify(bill),
      Number(bill.createdAt) || Number(bill.updatedAt) || 0,
    ]);
  }

  const blobs = {
    caps: bundle.caps,
    categories: bundle.categories,
    plan: bundle.plan,
    snapshots: bundle.snapshot,
    accounts: bundle.legacyAccounts,
    goals: bundle.goals || [],
    seeded: "1",
  };
  for (const [key, value] of Object.entries(blobs)) {
    await exec(db, "INSERT INTO finance_blobs (key, body) VALUES (?, ?)", [key, JSON.stringify(value)]);
  }
}

async function readBlob(db, key) {
  const result = await exec(db, "SELECT body FROM finance_blobs WHERE key = ?", [key]);
  const row = result.rows[0];
  if (!row) return undefined;
  try {
    return JSON.parse(String(row.body));
  } catch {
    throw new StoreError();
  }
}

async function readDocs(db, entity, direction) {
  const result = await exec(
    db,
    `SELECT body FROM finance_docs WHERE entity = ? ORDER BY sort_key ${direction}, web_id ASC`,
    [entity],
  );
  return result.rows.map((row) => {
    try {
      return JSON.parse(String(row.body));
    } catch {
      throw new StoreError();
    }
  });
}

export async function loadFinanceRaw(db, { allowSeed = false, env = {} } = {}) {
  let plan = await readBlob(db, "plan");
  if (!plan) {
    if (!allowSeed) throw new StoreError();
    await writeFinanceBundle(db, seedBundle());
    plan = await readBlob(db, "plan");
  }
  const caps = await readBlob(db, "caps");
  const categories = await readBlob(db, "categories");
  const snapshot = await readBlob(db, "snapshots");
  const legacyAccounts = await readBlob(db, "accounts");
  const goals = await readBlob(db, "goals");
  if ((!caps && !categories) || !plan || !Number.isInteger(plan.cents) || !snapshot || !legacyAccounts || !Array.isArray(goals)) {
    throw new StoreError();
  }
  return {
    transactions: await readDocs(db, "transaction", "DESC"),
    categories,
    caps: caps && typeof caps === "object" && !Array.isArray(caps) ? caps : null,
    plan,
    snapshot,
    legacyAccounts,
    goals,
    accounts: await readDocs(db, "account", "ASC"),
    bills: await readDocs(db, "bill", "ASC"),
  };
}

export async function loadFinanceState(db, { allowSeed = false, env = {} } = {}) {
  let plan = await readBlob(db, "plan");
  if (!plan) {
    if (!allowSeed) throw new StoreError();
    await writeFinanceBundle(db, seedBundle());
    plan = await readBlob(db, "plan");
  }
  const caps = await readBlob(db, "caps");
  const storedCategories = await readBlob(db, "categories");
  const snapshot = await readBlob(db, "snapshots");
  const legacyAccounts = await readBlob(db, "accounts");
  const goals = await readBlob(db, "goals");
  if ((!caps && !storedCategories) || !plan || !Number.isInteger(plan.cents) || !snapshot || !legacyAccounts || !Array.isArray(goals)) {
    throw new StoreError();
  }
  const categories = normalizeCategories(storedCategories, storedCategories ? null : caps);
  const resolvedCaps = caps && typeof caps === "object" && !Array.isArray(caps) ? caps : defaultCaps(categories);
  return {
    transactions: await readDocs(db, "transaction", "DESC"),
    caps: resolvedCaps,
    categories,
    planCents: plan.cents,
    budgetsSaved: plan.budgetsSaved === true,
    snapshot,
    legacyAccounts,
    goals,
    manualAccounts: await readDocs(db, "account", "ASC"),
    bills: await readDocs(db, "bill", "ASC"),
  };
}

async function saveBills(db, bills) {
  for (const bill of bills) {
    await exec(db, "UPDATE finance_docs SET body = ? WHERE entity = 'bill' AND web_id = ?", [JSON.stringify(bill), bill.id]);
  }
}

export function createFinanceReads(db, { allowSeed = false, env = {}, transact = null } = {}) {
  async function state() {
    return loadFinanceState(db, { allowSeed, env });
  }

  async function bills(now = Date.now()) {
    const current = await state();
    const projected = projectBills(current.bills, now);
    if (!projected.changed) return billsSnapshot(projected.bills, current.transactions, current.manualAccounts, now);
    const apply = async (handle) => {
      const fresh = await loadFinanceState(handle, { allowSeed, env });
      const again = projectBills(fresh.bills, now);
      if (again.changed) await saveBills(handle, again.bills);
      return billsSnapshot(again.bills, fresh.transactions, fresh.manualAccounts, now);
    };
    return transact ? transact(apply) : apply(db);
  }

  return {
    async financeOverview(now, week, range) {
      const current = await state();
      const rolled = current.manualAccounts.length ? rollUpAccounts(current.manualAccounts) : null;
      const netWorthCents = rolled ? rolled.netWorthCents : current.snapshot.netWorthCents;
      return overview(current.transactions, now, week, range, current.caps, {
        planCents: current.planCents,
        snapshot: current.snapshot,
        categories: current.categories,
        budgetsSaved: current.budgetsSaved,
        netWorthCents,
      });
    },
    async financeCategory(now, week, category, period) {
      const current = await state();
      return categoryView(current.transactions, now, week, category, current.caps, current.categories, period);
    },
    async financeCategories(now, period) {
      const current = await state();
      return categoriesSnapshot(current.transactions, now, period, current.caps, current.categories, current.budgetsSaved);
    },
    async financeSpendingMonth(now, month = "") {
      const current = await state();
      return spendingMonth(current.transactions, now, current.caps, current.categories, current.budgetsSaved, current.planCents, month);
    },
    async financeBuckets(now = Date.now()) {
      const current = await state();
      return bucketsSnapshot(current.categories, current.transactions, now);
    },
    async financeAccounts(now = Date.now(), options = {}) {
      const current = await state();
      return accountsSnapshot(current.manualAccounts, current.legacyAccounts, now, options);
    },
    async financeAccount(id, now = Date.now()) {
      await state();
      if (!ACCOUNT_ID.test(String(id || ""))) return { status: 404, body: { detail: "That account is not here." } };
      const accounts = await readDocs(db, "account", "ASC");
      const account = accounts.find((item) => item.id === id);
      return account ? { status: 200, body: presentAccount(account, now) } : { status: 404, body: { detail: "That account is not here." } };
    },
    async financeDebts(now = Date.now()) {
      const current = await state();
      return debtsSnapshot(current.manualAccounts, now);
    },
    async financeDebt(id, now = Date.now()) {
      const current = await state();
      const debt = debtById(current.manualAccounts, id, now);
      return debt ? { status: 200, body: debt } : { status: 404, body: { detail: "That debt is not here." } };
    },
    financeBills: bills,
    async financeBill(id, now = Date.now()) {
      const view = await bills(now);
      const bill = view.bills.find((item) => item.id === id);
      return bill ? { status: 200, body: bill } : { status: 404, body: { detail: "That bill is not here." } };
    },
    async financeGoals() {
      return (await state()).goals;
    },
    async financeTransactions(now = Date.now(), week = "", accountId = "") {
      const current = await state();
      if (accountId && !ACCOUNT_ID.test(String(accountId))) return { status: 400, body: { detail: "Choose an account.", field: "accountId" } };
      if (accountId && !current.manualAccounts.some((account) => account.id === accountId)) {
        return { status: 400, body: { detail: "Choose an account.", field: "accountId" } };
      }
      return transactionsForWeek(current.transactions, now, week, accountId, current.categories);
    },
    async financeTransaction(id) {
      const current = await state();
      if (!TXN_ID.test(String(id || ""))) return { status: 404, body: { detail: "That transaction is not here." } };
      const rows = await readDocs(db, "transaction", "DESC");
      const row = rows.find((item) => item.id === id);
      return row ? { status: 200, body: presentTransaction(row, current.categories) } : { status: 404, body: { detail: "That transaction is not here." } };
    },
    async financeRows() {
      return (await state()).transactions;
    },
    async financeBundle() {
      const current = await state();
      return {
        transactions: current.transactions,
        caps: current.caps,
        categories: current.categories,
        planCents: current.planCents,
        budgetsSaved: current.budgetsSaved,
        snapshot: current.snapshot,
        accounts: current.legacyAccounts,
        goals: current.goals,
        manualAccounts: current.manualAccounts,
      };
    },
  };
}
