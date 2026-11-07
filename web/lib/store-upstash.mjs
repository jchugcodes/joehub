export class StoreError extends Error {
  constructor() {
    super("store unavailable");
    this.name = "StoreError";
  }
}

function ttlSeconds(expiresAt, now) {
  return Math.max(1, Math.ceil((expiresAt - now) / 1000));
}

function txnStorageKey(state, binding) {
  if (!state || !binding) return "";
  return `joehub:txn:${state}:${binding}`;
}

export function createUpstashStore({ url, token, fetchImpl = fetch }) {
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

  return {
    async getSession(id, now) {
      const session = await readJson(`joehub:sess:${id}`);
      if (!session) return null;
      if (session.revoked || now >= session.expiresAt) return null;
      const cut = await command(["GET", `joehub:cut:${session.owner}`]);
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
      await command(["SET", `joehub:sess:${session.id}`, JSON.stringify(session), "EX", String(life)]);
      await command(["SET", `joehub:device:${device.id}`, JSON.stringify(device), "EX", String(life)]);
      await command(["SADD", `joehub:devices:${session.owner}`, device.id]);
    },
    async revokeSession(id, now) {
      const session = await readJson(`joehub:sess:${id}`);
      if (!session) return;
      session.revoked = true;
      const life = ttlSeconds(session.expiresAt, now);
      await command(["SET", `joehub:sess:${id}`, JSON.stringify(session), "EX", String(life)]);
      const device = await readJson(`joehub:device:${session.deviceId}`);
      if (device) {
        device.revoked = true;
        await command(["SET", `joehub:device:${device.id}`, JSON.stringify(device), "EX", String(life)]);
      }
    },
    async revokeAll(owner, now) {
      await command(["SET", `joehub:cut:${owner}`, String(now), "EX", String(14 * 24 * 60 * 60)]);
    },
    async listDevices(owner, now) {
      const ids = (await command(["SMEMBERS", `joehub:devices:${owner}`])) || [];
      const cut = await command(["GET", `joehub:cut:${owner}`]);
      const rows = [];
      for (const id of ids) {
        const device = await readJson(`joehub:device:${id}`);
        if (!device) continue;
        if (cut != null && device.createdAt <= Number(cut)) device.revoked = true;
        if (now >= device.expiresAt) device.revoked = true;
        rows.push(device);
      }
      return rows;
    },
    async revokeDevice(deviceId, now) {
      const device = await readJson(`joehub:device:${deviceId}`);
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
      const name = `joehub:rl:${bucket}:${key}:${windowId}`;
      const count = Number(await command(["INCR", name]));
      if (count === 1) await command(["EXPIRE", name, String(Math.ceil(windowMs / 1000) + 1)]);
      return count <= limit;
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
