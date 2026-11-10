import { loadFixtures } from "./fixtures.mjs";
import { StoreError } from "./store-upstash.mjs";
import {
  COOKIE_NAME,
  listDevices,
  login,
  logout,
  openCookie,
  resolveSession,
  revokeAll,
  revokeDevice,
} from "./sessions.mjs";

export function readCookie(headers) {
  const raw = typeof headers.get === "function" ? headers.get("cookie") : headers.cookie;
  if (!raw) return "";
  for (const part of String(raw).split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return "";
}

async function limited(limiter, ip, now) {
  if (!limiter) return null;
  try {
    const allowed = await limiter.allow(ip || "direct", now);
    if (!allowed) return { status: 429, body: { detail: "rate limit" } };
    return null;
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
    return { status: 503, body: { detail: "unavailable" } };
  }
}

function presentDevice(device) {
  return {
    id: device.id,
    label: device.label,
    created_at: new Date(device.createdAt).toISOString(),
    expires_at: new Date(device.expiresAt).toISOString(),
    revoked: device.revoked,
  };
}

async function resolveStored(cookie, env, store, now) {
  if (store && typeof store.getSession === "function" && !store.sessions) {
    const secret = env.JOEHUB_SESSION_SECRET || "";
    const sessionId = openCookie(secret, cookie);
    if (!sessionId) return null;
    const session = await store.getSession(sessionId, now);
    if (!session || session.revoked || now >= session.expiresAt) return null;
    return session;
  }
  return resolveSession(cookie, env, store, now);
}

export async function handleGet(kind, headers, env, store, limiter, now, ip) {
  const blocked = await limited(limiter, ip, now);
  if (blocked) return blocked;
  try {
    if (!(await resolveStored(readCookie(headers), env, store, now))) {
      return { status: 401, body: { detail: "authentication required" } };
    }
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
  }
  return { status: 200, body: loadFixtures()[kind] };
}

export async function handleLogin(body, env, store, limiter, now, ip) {
  const blocked = await limited(limiter, ip, now);
  if (blocked) return blocked;
  const result = login(body || {}, env, store, now);
  if (result.cookie) {
    return { status: 200, body: { device_id: result.deviceId }, cookie: result.cookie };
  }
  return { status: result.status, body: { detail: result.error } };
}

export async function handleLogout(headers, env, store, limiter, now, ip) {
  const blocked = await limited(limiter, ip, now);
  if (blocked) return blocked;
  try {
    if (store && typeof store.revokeSession === "function" && !store.sessions) {
      const secret = env.JOEHUB_SESSION_SECRET || "";
      const sessionId = openCookie(secret, readCookie(headers));
      if (sessionId) await store.revokeSession(sessionId, now);
    } else {
      logout(readCookie(headers), env, store, now);
    }
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
  }
  return { status: 200, body: { ok: true }, clearCookie: true };
}

export async function handleDevices(headers, env, store, limiter, now, ip) {
  const blocked = await limited(limiter, ip, now);
  if (blocked) return blocked;
  try {
    const session = await resolveStored(readCookie(headers), env, store, now);
    if (!session) return { status: 401, body: { detail: "authentication required" } };
    if (store && typeof store.listDevices === "function" && !store.sessions) {
      const rows = await store.listDevices(session.owner, now);
      return { status: 200, body: rows.map(presentDevice) };
    }
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
  }
  const result = listDevices(readCookie(headers), env, store, now);
  if (result.status !== 200) return { status: result.status, body: { detail: result.error } };
  return { status: 200, body: result.devices };
}

export async function handleRevoke(deviceId, headers, env, store, limiter, now, ip) {
  const blocked = await limited(limiter, ip, now);
  if (blocked) return blocked;
  try {
    if (store && typeof store.revokeDevice === "function" && !store.sessions) {
      const session = await resolveStored(readCookie(headers), env, store, now);
      if (!session) return { status: 401, body: { detail: "authentication required" } };
      const found = await store.revokeDevice(deviceId, now);
      if (!found) return { status: 404, body: { detail: "unknown device" } };
      return { status: 200, body: { device_id: deviceId } };
    }
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
  }
  const result = revokeDevice(readCookie(headers), env, store, now, deviceId);
  if (result.status !== 200) return { status: result.status, body: { detail: result.error } };
  return { status: 200, body: { device_id: result.device_id } };
}

export async function handleRevokeAll(headers, env, store, limiter, now, ip) {
  const blocked = await limited(limiter, ip, now);
  if (blocked) return blocked;
  try {
    const session = await resolveStored(readCookie(headers), env, store, now);
    if (!session) return { status: 401, body: { detail: "authentication required" } };
    if (store && typeof store.revokeAll === "function" && !store.sessions) {
      await store.revokeAll(session.owner, now);
      return { status: 200, body: { ok: true } };
    }
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
  }
  const result = revokeAll(readCookie(headers), env, store, now);
  if (result.status !== 200) return { status: result.status, body: { detail: result.error } };
  return { status: 200, body: { ok: true } };
}

function idempotencyKey(headers) {
  const raw = typeof headers.get === "function" ? headers.get("idempotency-key") : headers["idempotency-key"];
  if (raw == null || String(raw).trim() === "") return { ok: true, key: "" };
  const key = String(raw).trim();
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(key)) return { ok: false };
  return { ok: true, key };
}

async function requireTasks(headers, env, store, limiter, now, ip) {
  const blocked = await limited(limiter, ip, now);
  if (blocked) return { blocked };
  try {
    const session = await resolveStored(readCookie(headers), env, store, now);
    if (!session) return { result: { status: 401, body: { detail: "authentication required" } } };
    return { session };
  } catch (error) {
    if (error instanceof StoreError || error) return { result: { status: 503, body: { detail: "unavailable" } } };
    return { result: { status: 503, body: { detail: "unavailable" } } };
  }
}

export async function handleTasksGet(headers, env, store, limiter, now, ip, url = "") {
  const gate = await requireTasks(headers, env, store, limiter, now, ip);
  if (gate.blocked) return gate.blocked;
  if (gate.result) return gate.result;
  try {
    const query = url ? new URL(url).searchParams.get("q") || "" : "";
    if (query.trim()) {
      if (!store || typeof store.searchTasks !== "function") return { status: 503, body: { detail: "unavailable" } };
      return { status: 200, body: await store.searchTasks(query, now) };
    }
    if (!store || typeof store.listUnfinishedTasks !== "function") {
      return { status: 503, body: { detail: "unavailable" } };
    }
    return { status: 200, body: await store.listUnfinishedTasks(now) };
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
    return { status: 503, body: { detail: "unavailable" } };
  }
}

export async function handleTaskComplete(id, headers, env, store, limiter, now, ip) {
  const gate = await requireTasks(headers, env, store, limiter, now, ip);
  if (gate.blocked) return gate.blocked;
  if (gate.result) return gate.result;
  try {
    if (!store || typeof store.completeTask !== "function") return { status: 503, body: { detail: "unavailable" } };
    return await store.completeTask(id, now);
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
    return { status: 503, body: { detail: "unavailable" } };
  }
}

export async function handleTaskReopen(id, headers, env, store, limiter, now, ip) {
  const gate = await requireTasks(headers, env, store, limiter, now, ip);
  if (gate.blocked) return gate.blocked;
  if (gate.result) return gate.result;
  try {
    if (!store || typeof store.reopenTask !== "function") return { status: 503, body: { detail: "unavailable" } };
    return await store.reopenTask(id, now);
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
    return { status: 503, body: { detail: "unavailable" } };
  }
}

export async function handleTaskGet(id, headers, env, store, limiter, now, ip) {
  const gate = await requireTasks(headers, env, store, limiter, now, ip);
  if (gate.blocked) return gate.blocked;
  if (gate.result) return gate.result;
  try {
    if (!store || typeof store.getTask !== "function") {
      return { status: 503, body: { detail: "unavailable" } };
    }
    const task = await store.getTask(id);
    if (!task) return { status: 404, body: { detail: "This task is no longer here." } };
    return { status: 200, body: task };
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
    return { status: 503, body: { detail: "unavailable" } };
  }
}

export async function handleTaskDelete(id, headers, env, store, limiter, now, ip) {
  const gate = await requireTasks(headers, env, store, limiter, now, ip);
  if (gate.blocked) return gate.blocked;
  if (gate.result) return gate.result;
  try {
    if (!store || typeof store.deleteTask !== "function") {
      return { status: 503, body: { detail: "unavailable" } };
    }
    return await store.deleteTask(id);
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
    return { status: 503, body: { detail: "unavailable" } };
  }
}

export async function handleTaskPatch(id, body, headers, env, store, limiter, now, ip) {
  const gate = await requireTasks(headers, env, store, limiter, now, ip);
  if (gate.blocked) return gate.blocked;
  if (gate.result) return gate.result;
  try {
    if (!store || typeof store.patchTask !== "function") {
      return { status: 503, body: { detail: "unavailable" } };
    }
    return await store.patchTask(id, body, now);
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
    return { status: 503, body: { detail: "unavailable" } };
  }
}

export async function handleTasksPost(body, headers, env, store, limiter, now, ip) {
  const gate = await requireTasks(headers, env, store, limiter, now, ip);
  if (gate.blocked) return gate.blocked;
  if (gate.result) return gate.result;
  const idem = idempotencyKey(headers);
  if (!idem.ok) return { status: 400, body: { detail: "Invalid Idempotency-Key" } };
  try {
    if (!store || typeof store.createTask !== "function") {
      return { status: 503, body: { detail: "unavailable" } };
    }
    const scope = gate.session && (gate.session.id || gate.session.owner) || "";
    return await store.createTask(body, idem.key, now, scope);
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
    return { status: 503, body: { detail: "unavailable" } };
  }
}

export async function handleGroceryGet(headers, env, store, limiter, now, ip) {
  const gate = await requireTasks(headers, env, store, limiter, now, ip);
  if (gate.blocked) return gate.blocked;
  if (gate.result) return gate.result;
  try {
    if (!store || typeof store.listGrocery !== "function") return { status: 503, body: { detail: "unavailable" } };
    return { status: 200, body: await store.listGrocery(now) };
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
    return { status: 503, body: { detail: "unavailable" } };
  }
}

export async function handleGroceryPost(body, headers, env, store, limiter, now, ip) {
  const gate = await requireTasks(headers, env, store, limiter, now, ip);
  if (gate.blocked) return gate.blocked;
  if (gate.result) return gate.result;
  const idem = idempotencyKey(headers);
  if (!idem.ok) return { status: 400, body: { detail: "Invalid Idempotency-Key" } };
  try {
    if (!store || typeof store.createGrocery !== "function") return { status: 503, body: { detail: "unavailable" } };
    const scope = gate.session && (gate.session.id || gate.session.owner) || "";
    return await store.createGrocery(body, idem.key, now, scope);
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
    return { status: 503, body: { detail: "unavailable" } };
  }
}

export async function handleGroceryItemGet(id, headers, env, store, limiter, now, ip) {
  const gate = await requireTasks(headers, env, store, limiter, now, ip);
  if (gate.blocked) return gate.blocked;
  if (gate.result) return gate.result;
  try {
    if (!store || typeof store.getGrocery !== "function") return { status: 503, body: { detail: "unavailable" } };
    const item = await store.getGrocery(id);
    if (!item) return { status: 404, body: { detail: "This item is no longer here." } };
    return { status: 200, body: item };
  } catch (error) {
    if (error instanceof StoreError || error) return { status: 503, body: { detail: "unavailable" } };
    return { status: 503, body: { detail: "unavailable" } };
  }
}
