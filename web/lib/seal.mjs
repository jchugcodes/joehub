async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function seal(secret, sessionId) {
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sessionId)));
  const mac = [...sig].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${sessionId}.${mac}`;
}

export async function openCookie(secret, cookie) {
  if (!cookie || !secret || secret.length < 16) return null;
  const dot = cookie.indexOf(".");
  if (dot <= 0) return null;
  const sessionId = cookie.slice(0, dot);
  const mac = cookie.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(sessionId) || !/^[0-9a-f]{64}$/.test(mac)) return null;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, hexToBytes(mac), new TextEncoder().encode(sessionId));
  return ok ? sessionId : null;
}
