import { createStore } from "./sessions.mjs";
import { createLimiter } from "./ratelimit.mjs";
import { readKeyPrefix } from "./keys.mjs";
import { installMemoryFinance } from "./finance.mjs";
import { installMemoryGrocery } from "./grocery.mjs";
import { installMemoryTasks } from "./tasks.mjs";
import { createUpstashLimiter, createUpstashStore, StoreError } from "./store-upstash.mjs";

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
// reads the same sessions and limits. An invalid JOEHUB_KEY_PREFIX never falls
// open onto the production key namespace.
function build(env) {
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

const globalKey = Symbol.for("joehub.web.memory");
const memory = globalThis[globalKey] || build(process.env);
globalThis[globalKey] = memory;

export const store = memory.store;
export const loginLimiter = memory.loginLimiter;
export const apiLimiter = memory.apiLimiter;
