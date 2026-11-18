const PUBLIC_VERCEL_ENV = ["NEXT", "PUBLIC", "VERCEL_ENV"].join("_");

export function skeletonsEnabled() {
  return true;
}

export function skeletonHoldsEnabled(env) {
  const source = env || process.env;
  return source.VERCEL_ENV !== "production" && source[PUBLIC_VERCEL_ENV] !== "production";
}
