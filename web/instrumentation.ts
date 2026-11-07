export async function register(): Promise<void> {
  const { assertSafeToStart } = await import("./lib/startup.mjs");
  assertSafeToStart(process.env);
}
