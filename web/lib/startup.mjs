import { isBuild, readAuthConfig } from "./auth-config.mjs";

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
}
