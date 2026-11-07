declare module "*.mjs" {
  export function loadFixtures(): import("../lib/contract").FixtureFile;
  export function clientIp(request: Request, env?: Record<string, string | undefined>, peer?: string): string;
  export function assertSafeToStart(env: NodeJS.ProcessEnv): void;
  export function handleGet(...args: any[]): { status: number; body: unknown };
  export function handleLogin(...args: any[]): {
    status: number;
    body: unknown;
    cookie?: string;
    clearCookie?: boolean;
  };
  export function handleLogout(...args: any[]): {
    status: number;
    body: unknown;
    cookie?: string;
    clearCookie?: boolean;
  };
  export function handleDevices(...args: any[]): { status: number; body: unknown };
  export function handleRevoke(...args: any[]): { status: number; body: unknown };
  export const store: unknown;
  export const loginLimiter: { allow(key: string, now: number): boolean };
  export const apiLimiter: { allow(key: string, now: number): boolean };
}
