export async function register(): Promise<void> {
  const { assertSafeToStart } = await import("./lib/startup.mjs");
  try {
    assertSafeToStart(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "refusing to start");
    process.exit(1);
  }
}
