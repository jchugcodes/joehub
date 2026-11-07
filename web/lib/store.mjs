import { createStore } from "./sessions.mjs";
import { createLimiter } from "./ratelimit.mjs";

export const store = createStore();
export const loginLimiter = createLimiter(5);
export const apiLimiter = createLimiter(60);
