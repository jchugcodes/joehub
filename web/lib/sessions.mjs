import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const COOKIE_NAME = "joehub_session";
const DEV_USERNAME = "synthetic";
const DEV_PASSWORD = "synthetic";

export function createStore() {
  const sessions = new Map();
  const devices = new Map();
  const txns = new Map();
  const store = { sessions, devices, txns };
  store.putSession = async (session) => {
    sessions.set(session.id, session);
    devices.set(session.deviceId, {
      id: session.deviceId,
      label: session.label || "device",
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      sessionId: session.id,
      revoked: !!session.revoked,
      owner: session.owner,
    });
  };
  store.putTxn = async (txn) => {
    txns.set(txn.state, txn);
  };
  store.getTxn = async (state) => txns.get(state) || null;
  store.takeTxn = async (state) => {
    const txn = txns.get(state) || null;
    txns.delete(state);
    return txn;
  };
  store.getSession = async (id) => sessions.get(id) || null;
  store.revokeSession = async (id) => {
    const session = sessions.get(id);
    if (!session) return;
    session.revoked = true;
    const device = devices.get(session.deviceId);
    if (device) device.revoked = true;
  };
  store.revokeAll = async (owner, now) => {
    for (const session of sessions.values()) {
      if (session.owner === owner && session.createdAt <= now) {
        session.revoked = true;
        const device = devices.get(session.deviceId);
        if (device) device.revoked = true;
      }
    }
  };
  return store;
}

function production(env) {
  return (
    env.JOEHUB_API_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.VERCEL_ENV === "production" ||
    env.VERCEL_ENV === "preview"
  );
}

function devAuthEnabled(env) {
  return env.JOEHUB_DEV_AUTH === "1" || env.JOEHUB_FAKE_AUTH === "1";
}

export function seal(secret, sessionId) {
  const mac = createHmac("sha256", secret).update(sessionId).digest("hex");
  return `${sessionId}.${mac}`;
}

export function openCookie(secret, cookie) {
  if (!cookie || !secret) return null;
  const dot = cookie.indexOf(".");
  if (dot <= 0) return null;
  const sessionId = cookie.slice(0, dot);
  const mac = cookie.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(sessionId).digest("hex");
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return sessionId;
}

export function login(body, env, store, nowMs) {
  if (production(env) || !devAuthEnabled(env)) {
    return { status: 404, error: "dev auth is disabled" };
  }
  const secret = env.JOEHUB_SESSION_SECRET || "";
  if (secret.length < 16) {
    return { status: 503, error: "refusing to start" };
  }
  const username = body && body.username;
  const password = body && body.password;
  if (username !== DEV_USERNAME || password !== DEV_PASSWORD) {
    return { status: 401, error: "authentication required" };
  }
  const sessionId = randomBytes(32).toString("hex");
  const deviceId = randomBytes(16).toString("hex");
  const label = String((body && body.device_label) || "device").trim().slice(0, 80) || "device";
  const session = {
    id: sessionId,
    deviceId,
    createdAt: nowMs,
    expiresAt: nowMs + SESSION_TTL_MS,
    revoked: false,
    owner: "dev:synthetic",
  };
  store.sessions.set(sessionId, session);
  store.devices.set(deviceId, {
    id: deviceId,
    label,
    createdAt: nowMs,
    expiresAt: session.expiresAt,
    sessionId,
    revoked: false,
  });
  return { status: 200, cookie: seal(secret, sessionId), deviceId };
}

export function newOwnerSession(owner, nowMs) {
  return {
    id: randomBytes(32).toString("hex"),
    deviceId: randomBytes(16).toString("hex"),
    createdAt: nowMs,
    expiresAt: nowMs + SESSION_TTL_MS,
    revoked: false,
    owner,
    label: "browser",
  };
}

export function resolveSession(cookie, env, store, nowMs) {
  const secret = env.JOEHUB_SESSION_SECRET || "";
  if (secret.length < 16) return null;
  const sessionId = openCookie(secret, cookie);
  if (!sessionId) return null;
  const session = store.sessions.get(sessionId);
  if (!session || session.revoked) return null;
  if (nowMs >= session.expiresAt) return null;
  return session;
}

export function logout(cookie, env, store, nowMs) {
  const session = resolveSession(cookie, env, store, nowMs);
  if (!session) return;
  session.revoked = true;
  const device = store.devices.get(session.deviceId);
  if (device) device.revoked = true;
}

export function listDevices(cookie, env, store, nowMs) {
  const session = resolveSession(cookie, env, store, nowMs);
  if (!session) return { status: 401, error: "authentication required" };
  return {
    status: 200,
    devices: [...store.devices.values()].map((device) => ({
      id: device.id,
      label: device.label,
      created_at: new Date(device.createdAt).toISOString(),
      expires_at: new Date(device.expiresAt).toISOString(),
      revoked: device.revoked,
    })),
  };
}

export function revokeDevice(cookie, env, store, nowMs, deviceId) {
  const session = resolveSession(cookie, env, store, nowMs);
  if (!session) return { status: 401, error: "authentication required" };
  const device = store.devices.get(deviceId);
  if (!device) return { status: 404, error: "unknown device" };
  device.revoked = true;
  const target = store.sessions.get(device.sessionId);
  if (target) target.revoked = true;
  return { status: 200, device_id: deviceId };
}

export function revokeAll(cookie, env, store, nowMs) {
  const session = resolveSession(cookie, env, store, nowMs);
  if (!session) return { status: 401, error: "authentication required" };
  for (const item of store.sessions.values()) {
    if (item.owner === session.owner && item.createdAt <= nowMs) {
      item.revoked = true;
      const device = store.devices.get(item.deviceId);
      if (device) device.revoked = true;
    }
  }
  return { status: 200 };
}
