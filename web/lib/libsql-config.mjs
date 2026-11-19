// JOEHUB_LIBSQL_URL and JOEHUB_LIBSQL_AUTH_TOKEN win. The Vercel Marketplace
// Turso integration sets TURSO_DATABASE_URL and TURSO_AUTH_TOKEN, which are
// the fallback. Neither pair selects a backend. JOEHUB_BACKEND_TASKS does that.

function first(primary, fallback) {
  const chosen = String(primary ?? "").trim();
  if (chosen) return chosen;
  return String(fallback ?? "").trim();
}

export function readLibsqlConfig(env = process.env) {
  return {
    url: first(env.JOEHUB_LIBSQL_URL, env.TURSO_DATABASE_URL),
    authToken: first(env.JOEHUB_LIBSQL_AUTH_TOKEN, env.TURSO_AUTH_TOKEN),
  };
}

export function remoteLibsqlUrl(value) {
  const text = String(value || "").trim();
  if (!text || text === ":memory:" || text.startsWith("file:")) return false;
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.protocol !== "libsql:" && url.protocol !== "https:") return false;
  return url.hostname.length > 0;
}

export function localLibsqlUrl(value) {
  const text = String(value || "").trim();
  return text === ":memory:" || text.startsWith("file:");
}
