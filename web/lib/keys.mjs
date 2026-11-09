const PRODUCTION_PREFIX = "joehub:";
const PREFIX_PATTERN = /^[a-z0-9-]+:$/;

// Preview sets JOEHUB_KEY_PREFIX (for example "joehub-preview:") so it can share
// one Upstash database with production. Unset or empty keeps every Redis key
// byte-for-byte on the joehub: namespace.
export function readKeyPrefix(env) {
  const raw = env ? env.JOEHUB_KEY_PREFIX : undefined;
  if (raw == null || raw === "") return { ok: true, prefix: PRODUCTION_PREFIX };
  if (typeof raw !== "string" || !PREFIX_PATTERN.test(raw)) return { ok: false };
  return { ok: true, prefix: raw };
}

export function applyKeyPrefix(prefix, logical) {
  if (!logical.startsWith(PRODUCTION_PREFIX)) {
    throw new Error("key is outside the joehub namespace");
  }
  return prefix + logical.slice(PRODUCTION_PREFIX.length);
}
