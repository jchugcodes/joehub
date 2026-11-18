const PUBLIC_VERCEL_ENV = ["NEXT", "PUBLIC", "VERCEL_ENV"].join("_");

export function skeletonsEnabled(env) {
  const source = env || process.env;
  return source.VERCEL_ENV !== "production" && source[PUBLIC_VERCEL_ENV] !== "production";
}
