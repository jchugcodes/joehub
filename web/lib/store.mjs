import { createStore } from "./sessions.mjs";
import { createLimiter } from "./ratelimit.mjs";
import { readKeyPrefix } from "./keys.mjs";
import { installMemoryFinance } from "./finance.mjs";
import { installMemoryGrocery } from "./grocery.mjs";
import { installMemoryTasks } from "./tasks.mjs";
import { readAreaBackends } from "./backend.mjs";
import { readLibsqlConfig } from "./libsql-config.mjs";
import { createSqliteStore } from "./store-sqlite.mjs";
import { createUpstashLimiter, createUpstashStore, StoreError } from "./store-upstash.mjs";

const TASK_METHODS = [
  "listUnfinishedTasks",
  "searchTasks",
  "createTask",
  "getTask",
  "patchTask",
  "completeTask",
  "reopenTask",
  "deleteTask",
  "listLists",
  "createList",
  "patchList",
  "deleteList",
];

const GROCERY_METHODS = [
  "listGrocery",
  "createGrocery",
  "getGrocery",
  "patchGrocery",
  "deleteGrocery",
  "checkGrocery",
  "uncheckGrocery",
  "clearGrocery",
];

const FINANCE_METHODS = [
  "financeOverview",
  "financeCategory",
  "financeCategories",
  "financeSpendingMonth",
  "financeAccounts",
  "financeAccount",
  "financeDebts",
  "financeDebt",
  "financeBills",
  "financeBill",
  "financeGoals",
  "financeTransactions",
  "financeTransaction",
  "financeRows",
  "financeBundle",
  "financeSaveCaps",
  "financeSaveBudgets",
  "financeBuckets",
  "financeCreateCategory",
  "financePatchCategory",
  "financeDeleteCategory",
  "financeCreateAccount",
  "financePatchAccount",
  "financeDeleteAccount",
  "financeCreateBill",
  "financePatchBill",
  "financeDeleteBill",
  "financeImportTransaction",
  "financeCreateGoal",
  "financePatchGoal",
  "financeDeleteGoal",
  "financeCreateTransaction",
  "financePatchTransaction",
  "financeSimulateRefresh",
  "financeResetLedger",
];

function unavailableStore() {
  const fail = async () => {
    throw new StoreError();
  };
  return {
    sessions: null,
    getSession: fail,
    putSession: fail,
    revokeSession: fail,
    revokeAll: fail,
    listDevices: fail,
    revokeDevice: fail,
    putTxn: fail,
    getTxn: fail,
    takeTxn: fail,
    hit: fail,
    listUnfinishedTasks: fail,
    searchTasks: fail,
    createTask: fail,
    getTask: fail,
    patchTask: fail,
    completeTask: fail,
    reopenTask: fail,
    deleteTask: fail,
    listLists: fail,
    createList: fail,
    patchList: fail,
    deleteList: fail,
    listGrocery: fail,
    createGrocery: fail,
    getGrocery: fail,
    patchGrocery: fail,
    deleteGrocery: fail,
    checkGrocery: fail,
    uncheckGrocery: fail,
    clearGrocery: fail,
  };
}

// Dev and unit tests keep one in-memory store for this process. Production and
// preview set the Upstash REST URL so every instance, including middleware,
// reads the same sessions and limits. JOEHUB_BACKEND_TASKS=sqlite moves Tasks
// and the task lists that read or write those tasks onto libSQL.
// JOEHUB_BACKEND_GROCERY=sqlite moves Grocery onto libSQL.
// JOEHUB_BACKEND_FINANCE=sqlite moves Finance reads and writes onto libSQL
// together. One flag does not move another area. The libSQL
// URL and token are JOEHUB_LIBSQL_URL and JOEHUB_LIBSQL_AUTH_TOKEN, then
// TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. The Turso names do not select a
// backend. Sessions and devices stay on this store.
// An invalid JOEHUB_KEY_PREFIX never falls open onto the production key namespace.
function buildBase(env) {
  const prefix = readKeyPrefix(env);
  if (!prefix.ok) {
    const fail = async () => {
      throw new StoreError();
    };
    return {
      store: unavailableStore(),
      loginLimiter: { allow: fail },
      apiLimiter: { allow: fail },
    };
  }
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    const store = createUpstashStore({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
      prefix: prefix.prefix,
      env,
    });
    return {
      store,
      loginLimiter: createUpstashLimiter(store, "login", 5, 60_000),
      apiLimiter: createUpstashLimiter(store, "api", 60, 60_000),
    };
  }
  return {
    store: installMemoryFinance(installMemoryGrocery(installMemoryTasks(createStore()))),
    loginLimiter: createLimiter(5),
    apiLimiter: createLimiter(60),
  };
}

function useSqliteMethods(store, sqlite, methods) {
  const next = { ...store };
  for (const name of methods) {
    const method = sqlite[name];
    next[name] = (...args) => method(...args);
  }
  return next;
}

export function createRuntime(env = process.env, options = {}) {
  const areas = readAreaBackends(env);
  const runtime = buildBase(env);
  if (!readKeyPrefix(env).ok) return runtime;
  const tasksOn = areas.tasks === "sqlite";
  const groceryOn = areas.grocery === "sqlite";
  const financeOn = areas.finance === "sqlite";
  if (!tasksOn && !groceryOn && !financeOn) return runtime;
  const client = options.sqliteClient || options.tasksClient || options.groceryClient || options.financeClient;
  const sqlite = client
    ? createSqliteStore({ client, env })
    : createSqliteStore({ ...readLibsqlConfig(env), env });
  let store = runtime.store;
  if (tasksOn) store = useSqliteMethods(store, sqlite, TASK_METHODS);
  if (groceryOn) store = useSqliteMethods(store, sqlite, GROCERY_METHODS);
  if (financeOn) store = useSqliteMethods(store, sqlite, FINANCE_METHODS);
  return { ...runtime, store };
}

const globalKey = Symbol.for("joehub.web.memory");
const memory = globalThis[globalKey] || createRuntime(process.env);
globalThis[globalKey] = memory;

export const store = memory.store;
export const loginLimiter = memory.loginLimiter;
export const apiLimiter = memory.apiLimiter;
