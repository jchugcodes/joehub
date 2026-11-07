import { createStore } from "./sessions.mjs";
import { createLimiter } from "./ratelimit.mjs";
import { createUpstashLimiter, createUpstashStore } from "./store-upstash.mjs";

// Dev and unit tests keep one in-memory store for this process. Production and
// preview set the Upstash REST URL so every instance, including middleware,
// reads the same sessions and limits.
function build(env) {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    const store = createUpstashStore({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
    return {
      store,
      loginLimiter: createUpstashLimiter(store, "login", 5, 60_000),
      apiLimiter: createUpstashLimiter(store, "api", 60, 60_000),
    };
  }
  return {
    store: createStore(),
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
