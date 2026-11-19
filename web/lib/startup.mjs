import { isBuild, productionLike, readAuthConfig } from "./auth-config.mjs";
import { anyAreaSqlite, readAreaBackends } from "./backend.mjs";

const FORBIDDEN = [
  "JOEHUB_DB_PATH",
  "JOEHUB_KEY_DIR",
  "JOEHUB_EXPORT_DIR",
  "JOEHUB_OPERATOR_TOKEN",
  "JOEHUB_AGE_IDENTITY",
  "JOEHUB_AUTH_HASH",
  "JOEHUB_AUTH_HASH_FILE",
];

export function assertSafeToStart(env) {
  if (isBuild(env)) return;
  for (const name of FORBIDDEN) {
    if (env[name]) {
      throw new Error("refusing to start: database, age key, or operator settings are present");
    }
  }
  const config = readAuthConfig(env);
  if (!config.ok) throw new Error(`refusing to start: ${config.error}`);
  const areas = readAreaBackends(env);
  if (anyAreaSqlite(areas) && productionLike(env)) assertRemoteLibsql(env);
}

function assertRemoteLibsql(env) {
  const url = String(env.JOEHUB_LIBSQL_URL || "").trim();
  const token = String(env.JOEHUB_LIBSQL_AUTH_TOKEN || "").trim();
  if (!remoteLibsqlUrl(url)) {
    throw new Error("refusing to start: libSQL URL must be a remote libsql:// or https:// database");
  }
  if (!token) throw new Error("refusing to start: libSQL auth token is missing");
}

function remoteLibsqlUrl(value) {
  if (!value || value === ":memory:" || value.startsWith("file:")) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "libsql:" && url.protocol !== "https:") return false;
  return url.hostname.length > 0;
}
