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
  const phase = String(env.NEXT_PHASE || "");
  const life = String(env.npm_lifecycle_event || "");
  if (phase.includes("build") || life === "build") return;
  for (const name of FORBIDDEN) {
    if (env[name]) {
      throw new Error("refusing to start: database, age key, or operator settings are present");
    }
  }
  const production = env.JOEHUB_API_ENV === "production" || env.NODE_ENV === "production";
  const devAuth = env.JOEHUB_DEV_AUTH === "1" || env.JOEHUB_FAKE_AUTH === "1";
  const secret = env.JOEHUB_SESSION_SECRET || "";
  if (production && (devAuth || secret.length < 16)) {
    throw new Error("refusing to start: production forbids dev auth and requires a session secret");
  }
}
