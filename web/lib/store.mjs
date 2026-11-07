import { createStore } from "./sessions.mjs";
import { createLimiter } from "./ratelimit.mjs";

// Next compiles route handlers as separate bundles, so a module-level Map is
// not shared. One process still keeps a single in-memory store. A cold start
// or another instance does not. That limit is documented as a deploy blocker.
const globalKey = Symbol.for("joehub.web.memory");
const memory = globalThis[globalKey] || {
  store: createStore(),
  loginLimiter: createLimiter(5),
  apiLimiter: createLimiter(60),
};
globalThis[globalKey] = memory;

export const store = memory.store;
export const loginLimiter = memory.loginLimiter;
export const apiLimiter = memory.apiLimiter;
