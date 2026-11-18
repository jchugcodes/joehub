const PUBLIC_VERCEL_ENV = ["NEXT", "PUBLIC", "VERCEL_ENV"].join("_");

function production(env) {
  const source = env || process.env;
  return source.VERCEL_ENV === "production" || source[PUBLIC_VERCEL_ENV] === "production";
}

export function overlaysEnabled() {
  return true;
}

export function overlayHoldsEnabled(env) {
  return !production(env);
}
