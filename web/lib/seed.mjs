// Synthetic samples stay on for local dev, tests, and Vercel preview.
// Production (VERCEL_ENV=production) never writes them. NODE_ENV alone does not count.
export function syntheticSeedEnabled(env = process.env) {
  return !env || env.VERCEL_ENV !== "production";
}
