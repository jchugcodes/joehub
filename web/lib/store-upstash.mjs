import { applyKeyPrefix } from "./keys.mjs";
import { syntheticSeedEnabled } from "./seed.mjs";
import { accountsSnapshot, categoriesFromCaps, categoryView, createAccount, createTransaction, defaultCaps, envelopeTotal, normalizeCategories, overview, parseCaps, patchAccount, patchTransaction, presentAccount, presentTransaction, publicCategories, removeAccount, resetLedger, rollUpAccounts, seedSnapshots, simulateLedgerRefresh, transactionsForWeek, SEED_ACCOUNT_LINKS, SEED_ACCOUNTS, SEED_TRANSACTIONS, ACCOUNTS, GOALS, PLAN_CENTS } from "./finance.mjs";
import { readOptionalSourceId } from "./source-id.mjs";
import { performCheck as performGroceryCheck, performClear as performGroceryClear, performCreate as performGroceryCreate, performDelete as performGroceryDelete, performPatch as performGroceryPatch, SAMPLE_GROCERY } from "./grocery.mjs";
import { buildSampleTasks, combineSearch, DONE_WINDOW_MS, performComplete, performCreate, performDelete, performPatch, performReopen, recentCompletedNewestFirst, unfinishedNewestFirst } from "./tasks.mjs";

export class StoreError extends Error {
  constructor() {
    super("store unavailable");
    this.name = "StoreError";
  }
}

function ttlSeconds(expiresAt, now) {
  return Math.max(1, Math.ceil((expiresAt - now) / 1000));
}

const PREFIX_PATTERN = /^[a-z0-9-]+:$/;

export function createUpstashStore({ url, token, fetchImpl = fetch, prefix = "joehub:", env = process.env }) {
  if (typeof prefix !== "string" || !PREFIX_PATTERN.test(prefix)) throw new StoreError();
  const allowSeed = syntheticSeedEnabled(env);

  function k(logical) {
    try {
      return applyKeyPrefix(prefix, logical);
    } catch {
      throw new StoreError();
    }
  }

  function txnStorageKey(state, binding) {
    if (!state || !binding) return "";
    return k(`joehub:txn:${state}:${binding}`);
  }

  async function command(args) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(args),
      });
    } catch {
      throw new StoreError();
    }
    if (!response.ok) throw new StoreError();
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new StoreError();
    }
    if (!payload || Object.prototype.hasOwnProperty.call(payload, "error")) throw new StoreError();
    return payload.result;
  }

  async function syncSource(prefix, previous, next) {
    const before = previous && previous.sourceId;
    const after = next && next.sourceId;
    if (before && before !== after) {
      const key = k(`${prefix}${before}`);
      if ((await command(["GET", key])) === previous.id) await command(["DEL", key]);
    }
    if (after && next && next.id) await command(["SET", k(`${prefix}${after}`), next.id]);
  }

  async function idForSource(prefix, sourceId) {
    if (!sourceId) return "";
    const id = await command(["GET", k(`${prefix}${sourceId}`)]);
    return typeof id === "string" ? id : "";
  }

  async function readJson(key) {
    const raw = await command(["GET", key]);
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      throw new StoreError();
    }
  }

  async function placeSample(sample) {
    const created = await command(["SET", k(`joehub:task:${sample.id}`), JSON.stringify(sample), "NX"]);
    if (created !== "OK") return;
    const done = sample.status === "Done";
    const index = done ? "joehub:tasks:done" : "joehub:tasks:active";
    const score = done ? sample.completedAt : sample.createdAt;
    await command(["ZADD", k(index), String(score), sample.id]);
  }

  async function addMissingSamples(samples, version) {
    const flagKey = k(`joehub:tasks:seeded:${version}`);
    if ((await command(["GET", flagKey])) != null) return;
    for (const sample of samples) await placeSample(sample);
    await command(["SET", flagKey, "1", "NX"]);
  }

  async function ensureBotSamples(samples) {
    const flagKey = k("joehub:tasks:seeded:v2");
    if ((await command(["GET", flagKey])) != null) return;
    for (const sample of samples) {
      if (!sample.bot) continue;
      const key = k(`joehub:task:${sample.id}`);
      const existing = await readJson(key);
      if (!existing) {
        const created = await command(["SET", key, JSON.stringify(sample), "NX"]);
        if (created === "OK") {
          await command(["ZADD", k("joehub:tasks:active"), String(sample.createdAt), sample.id]);
        }
        continue;
      }
      if (existing.bot) continue;
      await command(["SET", key, JSON.stringify({ ...existing, bot: sample.bot })]);
    }
    await command(["SET", flagKey, "1", "NX"]);
  }

  async function ensureSeeded() {
    if (!allowSeed) return;
    const flagKey = k("joehub:tasks:seeded");
    const samples = buildSampleTasks(Date.now());
    if ((await command(["GET", flagKey])) == null) {
      for (const sample of samples) await placeSample(sample);
      await command(["SET", flagKey, "1", "NX"]);
    }
    await ensureBotSamples(samples);
    await addMissingSamples(samples.filter((sample) => sample.status !== "Done"), "v3");
    await addMissingSamples(samples.filter((sample) => sample.status === "Done"), "v4");
  }

  const tasks = {
    async putTask(task) {
      const result = await command(["SET", k(`joehub:task:${task.id}`), JSON.stringify(task), "NX"]);
      if (result !== "OK") return false;
      await command(["ZADD", k("joehub:tasks:active"), String(task.createdAt), task.id]);
      await syncSource("joehub:task:bysource:", null, task);
      return true;
    },
    async replaceTask(task) {
      const previous = await readJson(k(`joehub:task:${task.id}`));
      await command(["SET", k(`joehub:task:${task.id}`), JSON.stringify(task)]);
      await syncSource("joehub:task:bysource:", previous, task);
      if (task.status === "Done") {
        await command(["ZREM", k("joehub:tasks:active"), task.id]);
        await command(["ZADD", k("joehub:tasks:done"), String(task.completedAt), task.id]);
        return;
      }
      await command(["ZREM", k("joehub:tasks:done"), task.id]);
      await command(["ZADD", k("joehub:tasks:active"), String(task.createdAt), task.id]);
    },
    async removeTask(id) {
      const previous = await readJson(k(`joehub:task:${id}`));
      await command(["DEL", k(`joehub:task:${id}`)]);
      await syncSource("joehub:task:bysource:", previous, null);
      await command(["ZREM", k("joehub:tasks:active"), id]);
      await command(["ZREM", k("joehub:tasks:done"), id]);
    },
    async purgeDone(now) {
      const cutoff = now - DONE_WINDOW_MS;
      const ids = (await command(["ZRANGEBYSCORE", k("joehub:tasks:done"), "0", String(cutoff - 1)])) || [];
      for (const id of ids) await this.removeTask(id);
    },
    async getTask(id) {
      if (typeof id !== "string" || !/^[A-Za-z0-9-]{1,80}$/.test(id)) return null;
      return readJson(k(`joehub:task:${id}`));
    },
    async readIdem(key) {
      const parsed = await readJson(k(`joehub:task:idem:${key}`));
      if (!parsed) return null;
      if (parsed.status && parsed.body) return { status: parsed.status, body: parsed.body };
      if (parsed.pending && parsed.taskId) {
        const task = await readJson(k(`joehub:task:${parsed.taskId}`));
        if (task) return { status: 201, body: task };
      }
      if (parsed.pending) return null;
      throw new StoreError();
    },
    async writeIdem(key, response) {
      await command(["SET", k(`joehub:task:idem:${key}`), JSON.stringify(response), "EX", "86400"]);
    },
    async noteCreated(key, response) {
      const taskId = response && response.body ? response.body.id : "";
      await command([
        "SET",
        k(`joehub:task:idem:${key}`),
        JSON.stringify({ pending: true, taskId }),
        "EX",
        "86400",
      ]);
    },
    async claimIdem(key) {
      const result = await command(["SET", k(`joehub:task:idem:${key}`), JSON.stringify({ pending: true }), "NX", "EX", "30"]);
      return result === "OK";
    },
    async releasePending(key) {
      const parsed = await readJson(k(`joehub:task:idem:${key}`));
      if (parsed && parsed.pending && !parsed.taskId) await command(["DEL", k(`joehub:task:idem:${key}`)]);
    },
  };

  function financeScore(row) {
    const day = Number(String(row.date || "").replaceAll("-", ""));
    const created = Number(row.createdAt) || 0;
    return String(day * 1_000_000 + (created % 1_000_000));
  }

  function legacyFinance(raw) {
    if (raw == null || raw === "1") return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.transactions)) return parsed;
    } catch {
      return null;
    }
    return null;
  }

  async function ensureAccountSeed() {
    if (!allowSeed) return;
    const flagKey = k("joehub:finance:seeded:v2");
    if ((await command(["GET", flagKey])) != null) return;
    for (const account of SEED_ACCOUNTS) {
      const key = k(`joehub:finance:account:${account.id}`);
      const created = await command(["SET", key, JSON.stringify(account), "NX"]);
      if (created === "OK" || (await command(["GET", key])) != null) {
        await command(["ZADD", k("joehub:finance:accounts:index"), String(account.createdAt), account.id]);
      }
    }
    for (const link of SEED_ACCOUNT_LINKS) {
      const key = k(`joehub:finance:txn:${link.id}`);
      const existing = await readJson(key);
      if (!existing || existing.accountId) continue;
      await command(["SET", key, JSON.stringify({ ...existing, accountId: link.accountId })]);
    }
    await command(["SET", flagKey, "1", "NX"]);
  }

  async function ensureFinance() {
    if (!allowSeed) return;
    const flagKey = k("joehub:finance:seeded");
    const raw = await command(["GET", flagKey]);
    if (raw === "1") {
      await ensureAccountSeed();
      return;
    }
    const legacy = legacyFinance(raw);
    const transactions = legacy ? legacy.transactions : SEED_TRANSACTIONS;
    const caps = legacy && legacy.caps && typeof legacy.caps === "object" ? legacy.caps : defaultCaps();
    const planCents = legacy && Number.isInteger(legacy.planCents) ? legacy.planCents : PLAN_CENTS;
    await command(["SET", k("joehub:finance:caps"), JSON.stringify(caps), "NX"]);
    await command(["SET", k("joehub:finance:categories"), JSON.stringify(publicCategories(categoriesFromCaps(caps))), "NX"]);
    await command(["SET", k("joehub:finance:plan"), JSON.stringify({ cents: planCents }), "NX"]);
    await command(["SET", k("joehub:finance:accounts"), JSON.stringify(legacy && legacy.accounts ? legacy.accounts : ACCOUNTS), "NX"]);
    await command(["SET", k("joehub:finance:goals"), JSON.stringify(legacy && legacy.goals ? legacy.goals : GOALS), "NX"]);
    await command(["SET", k("joehub:finance:snapshots"), JSON.stringify(legacy && legacy.snapshots ? legacy.snapshots : seedSnapshots()), "NX"]);
    for (const row of transactions) {
      await command(["SET", k(`joehub:finance:txn:${row.id}`), JSON.stringify(row), "NX"]);
      await command(["ZADD", k("joehub:finance:txns"), financeScore(row), row.id]);
    }
    if (legacy && legacy.idem && typeof legacy.idem === "object") {
      for (const [idemKey, value] of Object.entries(legacy.idem)) {
        await command(["SET", k(`joehub:finance:txn:idem:${idemKey}`), JSON.stringify(value), "NX", "EX", "86400"]);
      }
    }
    if (legacy) await command(["SET", flagKey, "1"]);
    else await command(["SET", flagKey, "1", "NX"]);
    await ensureAccountSeed();
  }

  async function listManualAccounts() {
    const ids = (await command(["ZRANGEBYSCORE", k("joehub:finance:accounts:index"), "0", "9007199254740991"])) || [];
    const accounts = [];
    for (const id of ids) {
      const account = await readJson(k(`joehub:finance:account:${id}`));
      if (account) accounts.push(account);
    }
    return accounts;
  }

  function accountIdOk(id) {
    return /^acct-[A-Za-z0-9._:-]{1,70}$/.test(String(id || ""));
  }

  async function ensureGrocerySeeded() {
    if (!allowSeed) return;
    const flagKey = k("joehub:grocery:seeded");
    const flag = await command(["GET", flagKey]);
    if (flag != null) return;
    for (const sample of SAMPLE_GROCERY) {
      await command(["SET", k(`joehub:grocery:item:${sample.id}`), JSON.stringify(sample), "NX"]);
      await command(["ZADD", k("joehub:grocery:items:unchecked"), String(sample.createdAt), sample.id]);
    }
    await command(["SET", flagKey, "1", "NX"]);
  }

  const grocery = {
    async putItem(item) {
      const result = await command(["SET", k(`joehub:grocery:item:${item.id}`), JSON.stringify(item), "NX"]);
      if (result !== "OK") return false;
      await syncSource("joehub:grocery:item:bysource:", null, item);
      const score = item.checked ? item.checkedAt || item.updatedAt : item.createdAt;
      const index = item.checked ? "joehub:grocery:items:checked" : "joehub:grocery:items:unchecked";
      await command(["ZADD", k(index), String(score), item.id]);
      return true;
    },
    async replaceItem(item) {
      const key = k(`joehub:grocery:item:${item.id}`);
      const previous = await readJson(key);
      if (!previous) return false;
      await command(["SET", key, JSON.stringify(item)]);
      await syncSource("joehub:grocery:item:bysource:", previous, item);
      return true;
    },
    async moveItem(item) {
      const key = k(`joehub:grocery:item:${item.id}`);
      if (!(await readJson(key))) return false;
      await command(["SET", key, JSON.stringify(item)]);
      const unchecked = k("joehub:grocery:items:unchecked");
      const checked = k("joehub:grocery:items:checked");
      if (item.checked) {
        await command(["ZREM", unchecked, item.id]);
        await command(["ZADD", checked, String(item.checkedAt || item.updatedAt), item.id]);
      } else {
        await command(["ZREM", checked, item.id]);
        await command(["ZADD", unchecked, String(item.createdAt), item.id]);
      }
      return true;
    },
    async deleteItem(id) {
      if (typeof id !== "string" || !/^[A-Za-z0-9-]{1,80}$/.test(id)) return false;
      const key = k(`joehub:grocery:item:${id}`);
      const previous = await readJson(key);
      if (!previous) return false;
      await command(["DEL", key]);
      await syncSource("joehub:grocery:item:bysource:", previous, null);
      await command(["ZREM", k("joehub:grocery:items:unchecked"), id]);
      await command(["ZREM", k("joehub:grocery:items:checked"), id]);
      return true;
    },
    async getItem(id) {
      if (typeof id !== "string" || !/^[A-Za-z0-9-]{1,80}$/.test(id)) return null;
      return readJson(k(`joehub:grocery:item:${id}`));
    },
    async list() {
      const unchecked = (await command(["ZRANGEBYSCORE", k("joehub:grocery:items:unchecked"), "0", "9007199254740991"])) || [];
      const checked = (await command(["ZRANGEBYSCORE", k("joehub:grocery:items:checked"), "0", "9007199254740991"])) || [];
      const rows = [];
      for (const id of [...unchecked, ...checked]) {
        const item = await readJson(k(`joehub:grocery:item:${id}`));
        if (item) rows.push(item);
      }
      return rows;
    },
    async readIdem(key) {
      const parsed = await readJson(k(`joehub:grocery:item:idem:${key}`));
      if (!parsed) return null;
      if (parsed.status && parsed.body) return { status: parsed.status, body: parsed.body };
      if (parsed.pending && parsed.itemId) {
        const item = await readJson(k(`joehub:grocery:item:${parsed.itemId}`));
        if (item) return { status: 201, body: item };
      }
      if (parsed.pending) return null;
      throw new StoreError();
    },
    async writeIdem(key, response) {
      await command(["SET", k(`joehub:grocery:item:idem:${key}`), JSON.stringify(response), "EX", "86400"]);
    },
    async noteCreated(key, response) {
      const itemId = response && response.body ? response.body.id : "";
      await command([
        "SET",
        k(`joehub:grocery:item:idem:${key}`),
        JSON.stringify({ pending: true, itemId }),
        "EX",
        "86400",
      ]);
    },
    async claimIdem(key) {
      const result = await command(["SET", k(`joehub:grocery:item:idem:${key}`), JSON.stringify({ pending: true }), "NX", "EX", "30"]);
      return result === "OK";
    },
    async releasePending(key) {
      const parsed = await readJson(k(`joehub:grocery:item:idem:${key}`));
      if (parsed && parsed.pending && !parsed.itemId) await command(["DEL", k(`joehub:grocery:item:idem:${key}`)]);
    },
  };

  return {
    async getSession(id, now) {
      const session = await readJson(k(`joehub:sess:${id}`));
      if (!session) return null;
      if (session.revoked || now >= session.expiresAt) return null;
      const cut = await command(["GET", k(`joehub:cut:${session.owner}`)]);
      if (cut != null && session.createdAt <= Number(cut)) return null;
      return session;
    },
    async putSession(session, now) {
      const life = ttlSeconds(session.expiresAt, now);
      const device = {
        id: session.deviceId,
        label: session.label || "device",
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        sessionId: session.id,
        revoked: !!session.revoked,
        owner: session.owner,
      };
      await command(["SET", k(`joehub:sess:${session.id}`), JSON.stringify(session), "EX", String(life)]);
      await command(["SET", k(`joehub:device:${device.id}`), JSON.stringify(device), "EX", String(life)]);
      await command(["SADD", k(`joehub:devices:${session.owner}`), device.id]);
    },
    async revokeSession(id, now) {
      const session = await readJson(k(`joehub:sess:${id}`));
      if (!session) return;
      session.revoked = true;
      const life = ttlSeconds(session.expiresAt, now);
      await command(["SET", k(`joehub:sess:${id}`), JSON.stringify(session), "EX", String(life)]);
      const device = await readJson(k(`joehub:device:${session.deviceId}`));
      if (device) {
        device.revoked = true;
        await command(["SET", k(`joehub:device:${device.id}`), JSON.stringify(device), "EX", String(life)]);
      }
    },
    async revokeAll(owner, now) {
      await command(["SET", k(`joehub:cut:${owner}`), String(now), "EX", String(14 * 24 * 60 * 60)]);
    },
    async listDevices(owner, now) {
      const ids = (await command(["SMEMBERS", k(`joehub:devices:${owner}`)])) || [];
      const cut = await command(["GET", k(`joehub:cut:${owner}`)]);
      const rows = [];
      for (const id of ids) {
        const device = await readJson(k(`joehub:device:${id}`));
        if (!device) continue;
        if (cut != null && device.createdAt <= Number(cut)) device.revoked = true;
        if (now >= device.expiresAt) device.revoked = true;
        rows.push(device);
      }
      return rows;
    },
    async revokeDevice(deviceId, now) {
      const device = await readJson(k(`joehub:device:${deviceId}`));
      if (!device) return false;
      await this.revokeSession(device.sessionId, now);
      return true;
    },
    async putTxn(txn, now) {
      const key = txnStorageKey(txn.state, txn.binding);
      if (!key) return;
      const life = ttlSeconds(txn.createdAt + 10 * 60 * 1000, now);
      await command(["SET", key, JSON.stringify(txn), "EX", String(life)]);
    },
    async getTxn(state, binding) {
      const key = txnStorageKey(state, binding);
      if (!key) return null;
      return readJson(key);
    },
    async takeTxn(state, binding) {
      const key = txnStorageKey(state, binding);
      if (!key) return null;
      const raw = await command(["GETDEL", key]);
      if (raw == null) return null;
      try {
        const txn = JSON.parse(raw);
        if (!txn || txn.binding !== binding) return null;
        return txn;
      } catch {
        throw new StoreError();
      }
    },
    async hit(bucket, key, limit, windowMs, now) {
      const windowId = Math.floor(now / windowMs);
      const name = k(`joehub:rl:${bucket}:${key}:${windowId}`);
      const count = Number(await command(["INCR", name]));
      if (count === 1) await command(["EXPIRE", name, String(Math.ceil(windowMs / 1000) + 1)]);
      return count <= limit;
    },
    async listUnfinishedTasks(now) {
      await ensureSeeded();
      const ids = (await command(["ZREVRANGE", k("joehub:tasks:active"), "0", "-1"])) || [];
      const doneIds = (await command(["ZREVRANGE", k("joehub:tasks:done"), "0", "-1"])) || [];
      const open = [];
      for (const id of ids) {
        const task = await readJson(k(`joehub:task:${id}`));
        if (task && task.status !== "Done") open.push(task);
      }
      const done = [];
      for (const id of doneIds) {
        const task = await readJson(k(`joehub:task:${id}`));
        if (task && task.status === "Done") done.push(task);
      }
      return [...unfinishedNewestFirst(open), ...recentCompletedNewestFirst(done, now)];
    },
    async searchTasks(query, now) {
      await ensureSeeded();
      const activeIds = (await command(["ZREVRANGE", k("joehub:tasks:active"), "0", "-1"])) || [];
      const doneIds = (await command(["ZREVRANGE", k("joehub:tasks:done"), "0", "-1"])) || [];
      const unfinished = [];
      for (const id of activeIds) {
        const task = await readJson(k(`joehub:task:${id}`));
        if (task && task.status !== "Done") unfinished.push(task);
      }
      const done = [];
      for (const id of doneIds) {
        const task = await readJson(k(`joehub:task:${id}`));
        if (task && task.status === "Done") done.push(task);
      }
      done.sort((left, right) => (right.completedAt || 0) - (left.completedAt || 0));
      return combineSearch(unfinished, done, query);
    },
    async createTask(raw, idemKey, now, scope) {
      await ensureSeeded();
      const source = readOptionalSourceId(raw || {});
      if (source.ok && source.sourceId) {
        const existingId = await idForSource("joehub:task:bysource:", source.sourceId);
        if (existingId) {
          const existing = await tasks.getTask(existingId);
          if (existing) return performPatch(tasks, existingId, raw, now);
        }
      }
      return performCreate(tasks, raw, idemKey, now, undefined, scope || "");
    },
    async getTask(id) {
      await ensureSeeded();
      return tasks.getTask(id);
    },
    async patchTask(id, raw, now) {
      await ensureSeeded();
      return performPatch(tasks, id, raw, now);
    },
    async completeTask(id, now) {
      return performComplete(tasks, id, now);
    },
    async reopenTask(id, now) {
      return performReopen(tasks, id, now);
    },
    async deleteTask(id) {
      await ensureSeeded();
      return performDelete(tasks, id);
    },
    async listGrocery() {
      await ensureGrocerySeeded();
      return grocery.list();
    },
    async createGrocery(raw, idemKey, now, scope) {
      await ensureGrocerySeeded();
      const source = readOptionalSourceId(raw || {});
      if (source.ok && source.sourceId) {
        const existingId = await idForSource("joehub:grocery:item:bysource:", source.sourceId);
        if (existingId) {
          const existing = await grocery.getItem(existingId);
          if (existing) return performGroceryPatch(grocery, existingId, raw, now);
        }
      }
      return performGroceryCreate(grocery, raw, idemKey, now, undefined, scope || "");
    },
    async getGrocery(id) {
      await ensureGrocerySeeded();
      return grocery.getItem(id);
    },
    async patchGrocery(id, raw, now) {
      await ensureGrocerySeeded();
      return performGroceryPatch(grocery, id, raw, now);
    },
    async deleteGrocery(id) {
      await ensureGrocerySeeded();
      return performGroceryDelete(grocery, id);
    },
    async checkGrocery(id, now) {
      await ensureGrocerySeeded();
      return performGroceryCheck(grocery, id, now, true);
    },
    async uncheckGrocery(id, now) {
      await ensureGrocerySeeded();
      return performGroceryCheck(grocery, id, now, false);
    },
    async clearGrocery() {
      await ensureGrocerySeeded();
      return performGroceryClear(grocery);
    },
    async financeRows() {
      return (await this.financeBundle()).transactions;
    },
    async financeBundle() {
      await ensureFinance();
      const storedCaps = await readJson(k("joehub:finance:caps"));
      const storedCategories = await readJson(k("joehub:finance:categories"));
      const plan = await readJson(k("joehub:finance:plan"));
      const snapshot = await readJson(k("joehub:finance:snapshots"));
      const accounts = await readJson(k("joehub:finance:accounts"));
      const goals = await readJson(k("joehub:finance:goals"));
      const manualAccounts = await listManualAccounts();
      const categories = normalizeCategories(storedCategories, storedCategories ? null : storedCaps);
      const caps = storedCaps && typeof storedCaps === "object" && !Array.isArray(storedCaps) ? storedCaps : defaultCaps(categories);
      if ((!storedCaps && !storedCategories) || !plan || !Number.isInteger(plan.cents) || !snapshot || !accounts || !Array.isArray(goals)) throw new StoreError();
      const ids = (await command(["ZREVRANGE", k("joehub:finance:txns"), "0", "-1"])) || [];
      const transactions = [];
      for (const id of ids) {
        const row = await readJson(k(`joehub:finance:txn:${id}`));
        if (row) transactions.push(row);
      }
      return { transactions, caps, categories, planCents: plan.cents, snapshot, accounts, goals, manualAccounts };
    },
    async financeOverview(now, week, range) {
      const state = await this.financeBundle();
      const rolled = state.manualAccounts.length ? rollUpAccounts(state.manualAccounts) : null;
      const netWorthCents = rolled ? rolled.netWorthCents : state.snapshot.netWorthCents;
      return overview(state.transactions, now, week, range, state.caps, {
        planCents: state.planCents,
        snapshot: state.snapshot,
        categories: state.categories,
        netWorthCents,
      });
    },
    async financeCategory(now, week, category) {
      const state = await this.financeBundle();
      return categoryView(state.transactions, now, week, category, state.caps, state.categories);
    },
    async financeSaveCaps(body, idemKey) {
      const state = await this.financeBundle();
      if (idemKey) {
        const prior = await readJson(k(`joehub:finance:txn:idem:${idemKey}`));
        if (prior) return prior;
      }
      const parsed = parseCaps(body && body.caps, state.caps, state.categories);
      if (!parsed.ok) return { status: 400, body: { detail: parsed.detail, field: parsed.field } };
      const categories = categoriesFromCaps(parsed.caps, state.categories);
      const result = { status: 200, body: { caps: parsed.caps, envelopeCents: envelopeTotal(categories), categories: publicCategories(categories) } };
      await command(["SET", k("joehub:finance:caps"), JSON.stringify(parsed.caps)]);
      await command(["SET", k("joehub:finance:categories"), JSON.stringify(publicCategories(categories))]);
      if (idemKey) await command(["SET", k(`joehub:finance:txn:idem:${idemKey}`), JSON.stringify(result), "EX", "86400"]);
      return result;
    },
    async financeAccounts(now = Date.now(), options = {}) {
      await ensureFinance();
      const manualAccounts = await listManualAccounts();
      const legacy = (await readJson(k("joehub:finance:accounts"))) || ACCOUNTS;
      return accountsSnapshot(manualAccounts, legacy, now, options);
    },
    async financeAccount(id, now = Date.now()) {
      await ensureFinance();
      if (!accountIdOk(id)) return { status: 404, body: { detail: "That account is not here." } };
      const account = await readJson(k(`joehub:finance:account:${id}`));
      return account ? { status: 200, body: presentAccount(account, now) } : { status: 404, body: { detail: "That account is not here." } };
    },
    async financeCreateAccount(body, now = Date.now(), key = "") {
      await ensureFinance();
      if (key) {
        const prior = await readJson(k(`joehub:finance:account:idem:${key}`));
        if (prior) return prior;
      }
      const existing = await listManualAccounts();
      const seq = existing.filter((account) => String(account.id).startsWith("acct-") && String(account.id).includes("-")).length + 1;
      const result = createAccount(existing, body, now, seq);
      if (result.status === 201) {
        await command(["SET", k(`joehub:finance:account:${result.account.id}`), JSON.stringify(result.account)]);
        await command(["ZADD", k("joehub:finance:accounts:index"), String(result.account.createdAt), result.account.id]);
      }
      const stored = { status: result.status, body: result.body };
      if (key && result.status === 201) await command(["SET", k(`joehub:finance:account:idem:${key}`), JSON.stringify(stored), "EX", "86400"]);
      return stored;
    },
    async financePatchAccount(id, body, now = Date.now()) {
      await ensureFinance();
      const existing = await listManualAccounts();
      const result = patchAccount(existing, id, body, now);
      if (result.status === 200) await command(["SET", k(`joehub:finance:account:${id}`), JSON.stringify(result.account)]);
      return { status: result.status, body: result.body };
    },
    async financeDeleteAccount(id) {
      await ensureFinance();
      const account = accountIdOk(id) ? await readJson(k(`joehub:finance:account:${id}`)) : null;
      const rows = await this.financeRows();
      const result = removeAccount(account ? [account] : [], id, rows);
      if (result.status !== 200) return { status: result.status, body: result.body };
      await command(["DEL", k(`joehub:finance:account:${id}`)]);
      await command(["ZREM", k("joehub:finance:accounts:index"), id]);
      return { status: result.status, body: result.body };
    },
    async financeGoals() {
      return (await this.financeBundle()).goals;
    },
    async financeTransactions(now = Date.now(), week = "", accountId = "") {
      await ensureFinance();
      if (accountId && !accountIdOk(accountId)) return { status: 400, body: { detail: "Choose an account.", field: "accountId" } };
      if (accountId && !(await readJson(k(`joehub:finance:account:${accountId}`)))) {
        return { status: 400, body: { detail: "Choose an account.", field: "accountId" } };
      }
      return transactionsForWeek(await this.financeRows(), now, week, accountId);
    },
    async financeTransaction(id) {
      await ensureFinance();
      if (!/^[A-Za-z0-9._:-]{1,80}$/.test(String(id || ""))) return { status: 404, body: { detail: "That transaction is not here." } };
      const row = await readJson(k(`joehub:finance:txn:${id}`));
      return row ? { status: 200, body: presentTransaction(row) } : { status: 404, body: { detail: "That transaction is not here." } };
    },
    async financeCreateTransaction(body, now = Date.now(), key = "") {
      await ensureFinance();
      if (key) {
        const prior = await readJson(k(`joehub:finance:txn:idem:create:${key}`));
        if (prior) return prior;
      }
      const existing = await this.financeRows();
      const state = await this.financeBundle();
      const known = new Set((await listManualAccounts()).map((account) => account.id));
      const source = readOptionalSourceId(body || {});
      if (source.ok && source.sourceId) {
        const existingId = await idForSource("joehub:finance:txn:bysource:", source.sourceId);
        if (existingId) {
          const prior = existing.find((row) => row.id === existingId);
          const updated = patchTransaction(existing, existingId, body, now, state.categories, known);
          if (updated.status === 200) {
            const next = updated.rows.find((row) => row.id === existingId);
            await command(["SET", k(`joehub:finance:txn:${existingId}`), JSON.stringify(next)]);
            await command(["ZADD", k("joehub:finance:txns"), financeScore(next), existingId]);
            await syncSource("joehub:finance:txn:bysource:", prior, next);
          }
          return { status: updated.status, body: updated.body };
        }
      }
      const seq = existing.filter((row) => String(row.id).startsWith("fin-manual-")).length + 1;
      const result = createTransaction(existing, body, now, seq, state.categories, known);
      if (result.status === 201) {
        const created = result.rows[0];
        await command(["SET", k(`joehub:finance:txn:${created.id}`), JSON.stringify(created)]);
        await command(["ZADD", k("joehub:finance:txns"), financeScore(created), created.id]);
        await syncSource("joehub:finance:txn:bysource:", null, created);
      }
      const stored = { status: result.status, body: result.body };
      if (key && result.status === 201) await command(["SET", k(`joehub:finance:txn:idem:create:${key}`), JSON.stringify(stored), "EX", "86400"]);
      return stored;
    },
    async financePatchTransaction(id, body, now = Date.now()) {
      await ensureFinance();
      if (!/^[A-Za-z0-9._:-]{1,80}$/.test(String(id || ""))) return { status: 404, body: { detail: "That transaction is not here." } };
      const existing = await this.financeRows();
      const state = await this.financeBundle();
      const known = new Set(state.manualAccounts.map((account) => account.id));
      const prior = existing.find((row) => row.id === id);
      const result = patchTransaction(existing, id, body, now, state.categories, known);
      if (result.status === 200) {
        const next = result.rows.find((row) => row.id === id);
        await command(["SET", k(`joehub:finance:txn:${id}`), JSON.stringify(next)]);
        await command(["ZADD", k("joehub:finance:txns"), financeScore(next), id]);
        await syncSource("joehub:finance:txn:bysource:", prior, next);
      }
      return { status: result.status, body: result.body };
    },
    async financeSimulateRefresh(now = Date.now()) {
      const existing = await this.financeRows();
      const next = simulateLedgerRefresh(existing, now);
      const shell = next.find((row) => row.id === "fin-shell");
      if (shell) await command(["SET", k("joehub:finance:txn:fin-shell"), JSON.stringify(shell)]);
      return { status: 200, body: shell ? presentTransaction(shell) : { ok: true } };
    },
    async financeResetLedger(id) {
      if (!/^[A-Za-z0-9._:-]{1,80}$/.test(String(id || ""))) return { status: 404, body: { detail: "That transaction is not here." } };
      const existing = await this.financeRows();
      const result = resetLedger(existing, id);
      if (result.status === 200) {
        const next = result.rows.find((row) => row.id === id);
        await command(["SET", k(`joehub:finance:txn:${id}`), JSON.stringify(next)]);
      }
      return { status: result.status, body: result.body };
    },
  };
}

export function createUpstashLimiter(store, bucket, limit, windowMs) {
  return {
    allow(key, now) {
      return store.hit(bucket, key, limit, windowMs, now);
    },
  };
}
