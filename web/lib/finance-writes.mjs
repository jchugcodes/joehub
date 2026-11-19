import {
  applyMonthlyBudgets,
  categoriesFromCaps,
  createAccount,
  createBucket,
  createGoal,
  createTransaction,
  defaultCaps,
  deleteGoal,
  envelopeTotal,
  normalizeCategories,
  parseCaps,
  parseMonthlyBudgets,
  patchAccount,
  patchBucket,
  patchGoal,
  patchTransaction,
  presentTransaction,
  publicCategories,
  removeAccount,
  removeBucket,
  resetLedger,
  simulateLedgerRefresh,
} from "./finance.mjs";
import { createBill, deleteBill, importLedgerTransaction, patchBill, setBillPaid } from "./bills.mjs";
import { loadFinanceRaw, writeFinanceBundle } from "./finance-box.mjs";
import { readOptionalSourceId } from "./source-id.mjs";
import { StoreError } from "./store-upstash.mjs";

const IDEM_TTL_MS = 24 * 60 * 60 * 1000;
const TXN_ID = /^[A-Za-z0-9._:-]{1,80}$/;

function viewOf(raw) {
  const categories = normalizeCategories(raw.categories, raw.categories ? null : raw.caps);
  const caps = raw.caps && typeof raw.caps === "object" && !Array.isArray(raw.caps) ? raw.caps : defaultCaps(categories);
  return { categories, caps };
}

async function readIdem(db, key, now) {
  if (!key) return null;
  const result = await db.execute({ sql: "SELECT body, expires_at FROM finance_idem WHERE key = ?", args: [key] });
  const row = result.rows[0];
  if (!row) return null;
  if (Number(row.expires_at) <= now) {
    await db.execute({ sql: "DELETE FROM finance_idem WHERE key = ?", args: [key] });
    return null;
  }
  try {
    return JSON.parse(String(row.body));
  } catch {
    throw new StoreError();
  }
}

async function saveIdem(db, key, value, now) {
  if (!key) return;
  await db.execute({
    sql: `INSERT INTO finance_idem (key, body, expires_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET body = excluded.body, expires_at = excluded.expires_at`,
    args: [key, JSON.stringify(value), now + IDEM_TTL_MS],
  });
}

async function sourceWebId(db, sourceId) {
  if (!sourceId) return "";
  const result = await db.execute({ sql: "SELECT web_id FROM finance_sources WHERE source_id = ?", args: [sourceId] });
  const row = result.rows[0];
  return row ? String(row.web_id) : "";
}

function knownAccounts(raw) {
  return new Set(raw.accounts.map((account) => account.id));
}

export function createFinanceWrites(transact, { allowSeed = false, env = {} } = {}) {
  async function inTx(work) {
    return transact((db) => work(db));
  }

  return {
    async financeSaveCaps(body, idemKey) {
      return inTx(async (db) => {
        const now = Date.now();
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const key = idemKey ? `joehub:finance:txn:idem:${idemKey}` : "";
        const prior = await readIdem(db, key, now);
        if (prior) return prior;
        const view = viewOf(raw);
        const parsed = parseCaps(body && body.caps, view.caps, view.categories);
        if (!parsed.ok) return { status: 400, body: { detail: parsed.detail, field: parsed.field } };
        const categories = categoriesFromCaps(parsed.caps, view.categories);
        const result = {
          status: 200,
          body: { caps: parsed.caps, envelopeCents: envelopeTotal(categories), categories: publicCategories(categories) },
        };
        raw.caps = parsed.caps;
        raw.categories = publicCategories(categories);
        raw.fullCategories = categories;
        await writeFinanceBundle(db, raw);
        await saveIdem(db, key, result, now);
        return result;
      });
    },
    async financeSaveBudgets(body, idemKey) {
      return inTx(async (db) => {
        const now = Date.now();
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const key = idemKey ? `joehub:finance:budget:idem:${idemKey}` : "";
        const prior = await readIdem(db, key, now);
        if (prior) return prior;
        const view = viewOf(raw);
        const parsed = parseMonthlyBudgets(body && body.budgets, view.categories);
        if (!parsed.ok) return { status: 400, body: { detail: parsed.detail, field: parsed.field } };
        const categories = applyMonthlyBudgets(view.categories, parsed.budgets);
        const result = { status: 200, body: { saved: true, categories: publicCategories(categories) } };
        raw.categories = publicCategories(categories);
        raw.fullCategories = categories;
        raw.plan = { ...(raw.plan || {}), cents: raw.plan.cents, budgetsSaved: true };
        await writeFinanceBundle(db, raw);
        await saveIdem(db, key, result, now);
        return result;
      });
    },
    async financeCreateCategory(body, key = "") {
      return inTx(async (db) => {
        const now = Date.now();
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const idem = key ? `joehub:finance:category:idem:${key}` : "";
        const prior = await readIdem(db, idem, now);
        if (prior) return prior;
        const view = viewOf(raw);
        const result = createBucket(view.categories, body);
        const stored = { status: result.status, body: result.body };
        if (result.status === 201) {
          raw.categories = publicCategories(result.categories);
          raw.fullCategories = result.categories;
          await writeFinanceBundle(db, raw);
          if (key) await saveIdem(db, idem, stored, now);
        }
        return stored;
      });
    },
    async financePatchCategory(slug, body) {
      return inTx(async (db) => {
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const view = viewOf(raw);
        const result = patchBucket(view.categories, slug, body);
        if (result.status === 200) {
          raw.categories = publicCategories(result.categories);
          raw.fullCategories = result.categories;
          await writeFinanceBundle(db, raw);
        }
        return { status: result.status, body: result.body };
      });
    },
    async financeDeleteCategory(slug) {
      return inTx(async (db) => {
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const view = viewOf(raw);
        const result = removeBucket(view.categories, slug, raw.transactions, view.caps);
        if (result.status === 200) {
          raw.categories = publicCategories(result.categories);
          raw.fullCategories = result.categories;
          raw.transactions = result.transactions;
          raw.caps = result.caps;
          await writeFinanceBundle(db, raw);
        }
        return { status: result.status, body: result.body };
      });
    },
    async financeCreateAccount(body, now = Date.now(), key = "") {
      return inTx(async (db) => {
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const idem = key ? `joehub:finance:account:idem:${key}` : "";
        const prior = await readIdem(db, idem, Date.now());
        if (prior) return prior;
        const seq = raw.accounts.filter((account) => String(account.id).startsWith("acct-") && String(account.id).includes("-")).length + 1;
        const result = createAccount(raw.accounts, body, now, seq);
        if (result.status === 201) {
          raw.accounts = result.accounts;
          await writeFinanceBundle(db, raw);
        }
        const stored = { status: result.status, body: result.body };
        if (key && result.status === 201) await saveIdem(db, idem, stored, Date.now());
        return stored;
      });
    },
    async financePatchAccount(id, body, now = Date.now()) {
      return inTx(async (db) => {
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const result = patchAccount(raw.accounts, id, body, now);
        if (result.status === 200) {
          raw.accounts = result.accounts;
          await writeFinanceBundle(db, raw);
        }
        return { status: result.status, body: result.body };
      });
    },
    async financeDeleteAccount(id) {
      return inTx(async (db) => {
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const account = raw.accounts.find((item) => item.id === id) || null;
        const result = removeAccount(account ? [account] : [], id, raw.transactions);
        if (result.status === 200) {
          raw.accounts = raw.accounts.filter((item) => item.id !== id);
          await writeFinanceBundle(db, raw);
        }
        return { status: result.status, body: result.body };
      });
    },
    async financeCreateBill(body, now = Date.now(), key = "") {
      return inTx(async (db) => {
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const idem = key ? `joehub:finance:bill:idem:${key}` : "";
        const prior = await readIdem(db, idem, Date.now());
        if (prior) return prior;
        const seq = raw.bills.filter((bill) => String(bill.id).startsWith("bill-") && String(bill.id).includes("-")).length + 1;
        const result = createBill(raw.bills, raw.accounts, body, now, seq);
        if (result.status === 201) {
          raw.bills = result.bills;
          await writeFinanceBundle(db, raw);
        }
        const stored = { status: result.status, body: result.body };
        if (key && result.status === 201) await saveIdem(db, idem, stored, Date.now());
        return stored;
      });
    },
    async financePatchBill(id, body, now = Date.now()) {
      return inTx(async (db) => {
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const toggling = body && typeof body.paid === "boolean" && body.name == null && body.amountCents == null && body.dueDate == null;
        const result = toggling
          ? setBillPaid(raw.bills, raw.transactions, raw.accounts, id, body.paid, now)
          : patchBill(raw.bills, raw.transactions, raw.accounts, id, body, now);
        const billsChanged = Boolean(result.bills && result.bills !== raw.bills);
        const rowsChanged = Boolean(result.rows && result.rows !== raw.transactions);
        if (billsChanged) raw.bills = result.bills;
        if (rowsChanged) raw.transactions = result.rows;
        if (billsChanged || rowsChanged) await writeFinanceBundle(db, raw);
        return { status: result.status, body: result.body };
      });
    },
    async financeDeleteBill(id) {
      return inTx(async (db) => {
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const result = deleteBill(raw.bills, id);
        if (result.status === 200) {
          raw.bills = result.bills;
          await writeFinanceBundle(db, raw);
        }
        return { status: result.status, body: result.body };
      });
    },
    async financeImportTransaction(body) {
      return inTx(async (db) => {
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const result = importLedgerTransaction(raw.transactions, body);
        raw.transactions = result.rows;
        await writeFinanceBundle(db, raw);
        const transaction = result.transaction;
        return {
          status: 200,
          body: {
            linked: result.linked,
            id: transaction.id,
            sourceId: transaction.sourceId || null,
            billId: transaction.billId || null,
            transaction: presentTransaction(transaction),
          },
        };
      });
    },
    async financeCreateGoal(body, key = "") {
      return inTx(async (db) => {
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const idem = key ? `joehub:finance:goal:idem:${key}` : "";
        const prior = await readIdem(db, idem, Date.now());
        if (prior) return prior;
        const result = createGoal(raw.goals, body);
        if (result.status === 201) {
          raw.goals = result.goals;
          await writeFinanceBundle(db, raw);
        }
        const stored = { status: result.status, body: result.body };
        if (key && result.status === 201) await saveIdem(db, idem, stored, Date.now());
        return stored;
      });
    },
    async financePatchGoal(slug, body) {
      return inTx(async (db) => {
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const result = patchGoal(raw.goals, slug, body);
        if (result.status === 200) {
          raw.goals = result.goals;
          await writeFinanceBundle(db, raw);
        }
        return { status: result.status, body: result.body };
      });
    },
    async financeDeleteGoal(slug) {
      return inTx(async (db) => {
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const result = deleteGoal(raw.goals, slug);
        if (result.status === 200) {
          raw.goals = result.goals;
          await writeFinanceBundle(db, raw);
        }
        return { status: result.status, body: result.body };
      });
    },
    async financeCreateTransaction(body, now = Date.now(), key = "") {
      return inTx(async (db) => {
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const idem = key ? `joehub:finance:txn:idem:create:${key}` : "";
        const prior = await readIdem(db, idem, Date.now());
        if (prior) return prior;
        const view = viewOf(raw);
        const known = knownAccounts(raw);
        const source = readOptionalSourceId(body || {});
        if (source.ok && source.sourceId) {
          const existingId = await sourceWebId(db, source.sourceId);
          if (existingId) {
            const updated = patchTransaction(raw.transactions, existingId, body, now, view.categories, known);
            if (updated.status === 200) {
              raw.transactions = updated.rows;
              await writeFinanceBundle(db, raw);
            }
            return { status: updated.status, body: updated.body };
          }
        }
        const seq = raw.transactions.filter((row) => String(row.id).startsWith("fin-manual-")).length + 1;
        const result = createTransaction(raw.transactions, body, now, seq, view.categories, known);
        if (result.status === 201) {
          raw.transactions = result.rows;
          await writeFinanceBundle(db, raw);
        }
        const stored = { status: result.status, body: result.body };
        if (key && result.status === 201) await saveIdem(db, idem, stored, Date.now());
        return stored;
      });
    },
    async financePatchTransaction(id, body, now = Date.now()) {
      return inTx(async (db) => {
        if (!TXN_ID.test(String(id || ""))) return { status: 404, body: { detail: "That transaction is not here." } };
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const view = viewOf(raw);
        const result = patchTransaction(raw.transactions, id, body, now, view.categories, knownAccounts(raw));
        if (result.status === 200) {
          raw.transactions = result.rows;
          await writeFinanceBundle(db, raw);
        }
        return { status: result.status, body: result.body };
      });
    },
    async financeSimulateRefresh(now = Date.now()) {
      return inTx(async (db) => {
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const next = simulateLedgerRefresh(raw.transactions, now);
        const shell = next.find((row) => row.id === "fin-shell");
        if (shell) {
          raw.transactions = next;
          await writeFinanceBundle(db, raw);
        }
        return { status: 200, body: shell ? presentTransaction(shell) : { ok: true } };
      });
    },
    async financeResetLedger(id) {
      if (!TXN_ID.test(String(id || ""))) return { status: 404, body: { detail: "That transaction is not here." } };
      return inTx(async (db) => {
        const raw = await loadFinanceRaw(db, { allowSeed, env });
        const result = resetLedger(raw.transactions, id);
        if (result.status === 200) {
          raw.transactions = result.rows;
          await writeFinanceBundle(db, raw);
        }
        return { status: result.status, body: result.body };
      });
    },
  };
}
