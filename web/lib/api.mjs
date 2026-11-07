import { loadFixtures } from "./fixtures.mjs";
import {
  COOKIE_NAME,
  listDevices,
  login,
  logout,
  resolveSession,
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

function limited(limiter, ip, now) {
  if (limiter && !limiter.allow(ip || "local", now)) {
    return { status: 429, body: { detail: "rate limit" } };
  }
  return null;
}

export function handleGet(kind, headers, env, store, limiter, now, ip) {
  const blocked = limited(limiter, ip, now);
  if (blocked) return blocked;
  if (!resolveSession(readCookie(headers), env, store, now)) {
    return { status: 401, body: { detail: "authentication required" } };
  }
  return { status: 200, body: loadFixtures()[kind] };
}

export function handleLogin(body, env, store, limiter, now, ip) {
  const blocked = limited(limiter, ip, now);
  if (blocked) return blocked;
  const result = login(body || {}, env, store, now);
  if (result.cookie) {
    return { status: 200, body: { device_id: result.deviceId }, cookie: result.cookie };
  }
  return { status: result.status, body: { detail: result.error } };
}

export function handleLogout(headers, env, store, limiter, now, ip) {
  const blocked = limited(limiter, ip, now);
  if (blocked) return blocked;
  logout(readCookie(headers), env, store, now);
  return { status: 200, body: { ok: true }, clearCookie: true };
}

export function handleDevices(headers, env, store, limiter, now, ip) {
  const blocked = limited(limiter, ip, now);
  if (blocked) return blocked;
  const result = listDevices(readCookie(headers), env, store, now);
  if (result.status !== 200) return { status: result.status, body: { detail: result.error } };
  return { status: 200, body: result.devices };
}

export function handleRevoke(deviceId, headers, env, store, limiter, now, ip) {
  const blocked = limited(limiter, ip, now);
  if (blocked) return blocked;
  const result = revokeDevice(readCookie(headers), env, store, now, deviceId);
  if (result.status !== 200) return { status: result.status, body: { detail: result.error } };
  return { status: 200, body: { device_id: result.device_id } };
}
