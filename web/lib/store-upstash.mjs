import { applyKeyPrefix } from "./keys.mjs";
import { buildSampleTasks, combineSearch, DONE_WINDOW_MS, performComplete, performCreate, performPatch, performReopen, recentCompletedNewestFirst, unfinishedNewestFirst } from "./tasks.mjs";

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

export function createUpstashStore({ url, token, fetchImpl = fetch, prefix = "joehub:" }) {
  if (typeof prefix !== "string" || !PREFIX_PATTERN.test(prefix)) throw new StoreError();

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

  async function ensureSeeded() {
    const flagKey = k("joehub:tasks:seeded");
    const samples = buildSampleTasks(Date.now());
    if ((await command(["GET", flagKey])) == null) {
      for (const sample of samples) await placeSample(sample);
      await command(["SET", flagKey, "1", "NX"]);
    }
    await addMissingSamples(samples.filter((sample) => sample.status !== "Done"), "v3");
    await addMissingSamples(samples.filter((sample) => sample.status === "Done"), "v4");
  }

  const tasks = {
    async putTask(task) {
      const result = await command(["SET", k(`joehub:task:${task.id}`), JSON.stringify(task), "NX"]);
      if (result !== "OK") return false;
      await command(["ZADD", k("joehub:tasks:active"), String(task.createdAt), task.id]);
      return true;
    },
    async replaceTask(task) {
      await command(["SET", k(`joehub:task:${task.id}`), JSON.stringify(task)]);
      if (task.status === "Done") {
        await command(["ZREM", k("joehub:tasks:active"), task.id]);
        await command(["ZADD", k("joehub:tasks:done"), String(task.completedAt), task.id]);
        return;
      }
      await command(["ZREM", k("joehub:tasks:done"), task.id]);
      await command(["ZADD", k("joehub:tasks:active"), String(task.createdAt), task.id]);
    },
    async removeTask(id) {
      await command(["DEL", k(`joehub:task:${id}`)]);
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
  };
}

export function createUpstashLimiter(store, bucket, limit, windowMs) {
  return {
    allow(key, now) {
      return store.hit(bucket, key, limit, windowMs, now);
    },
  };
}
