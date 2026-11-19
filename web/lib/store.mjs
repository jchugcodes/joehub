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
  };
}

// Dev and unit tests keep one in-memory store for this process. Production and
// preview set the Upstash REST URL so every instance, including middleware,
// reads the same sessions and limits. JOEHUB_BACKEND_TASKS=sqlite moves Tasks
// and the task lists that read or write those tasks onto libSQL. The libSQL
// URL and token are JOEHUB_LIBSQL_URL and JOEHUB_LIBSQL_AUTH_TOKEN, then
// TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. The Turso names do not select a
// backend. Sessions, devices, grocery, and finance stay on this store.
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

function useSqliteTasks(store, sqlite) {
  const next = { ...store };
  for (const name of TASK_METHODS) {
    const method = sqlite[name];
    next[name] = (...args) => method(...args);
  }
  return next;
}

export function createRuntime(env = process.env, options = {}) {
  const areas = readAreaBackends(env);
  const runtime = buildBase(env);
  if (areas.tasks !== "sqlite" || !readKeyPrefix(env).ok) return runtime;
  const sqlite = options.tasksClient
    ? createSqliteStore({ client: options.tasksClient, env })
    : createSqliteStore({ ...readLibsqlConfig(env), env });
  return { ...runtime, store: useSqliteTasks(runtime.store, sqlite) };
}

const globalKey = Symbol.for("joehub.web.memory");
const memory = globalThis[globalKey] || createRuntime(process.env);
globalThis[globalKey] = memory;

export const store = memory.store;
export const loginLimiter = memory.loginLimiter;
export const apiLimiter = memory.apiLimiter;
