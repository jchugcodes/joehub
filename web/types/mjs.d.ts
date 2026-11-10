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
  export function handleTasksGet(...args: any[]): { status: number; body: unknown };
  export function handleTasksPost(...args: any[]): { status: number; body: unknown };
  export function handleTaskGet(...args: any[]): { status: number; body: unknown };
  export function handleTaskPatch(...args: any[]): { status: number; body: unknown };
  export function handleTaskComplete(...args: any[]): { status: number; body: unknown };
  export function handleTaskReopen(...args: any[]): { status: number; body: unknown };
  export function handleGroceryGet(...args: any[]): { status: number; body: unknown };
  export function handleGroceryPost(...args: any[]): { status: number; body: unknown };
  export function handleGroceryItemGet(...args: any[]): { status: number; body: unknown };
  export function groupGrocery(items: any[]): { label: string; items: any[] }[];
  export function existingName(items: any[], name: string): string;
  export const store: unknown;
  export const loginLimiter: { allow(key: string, now: number): boolean };
  export const apiLimiter: { allow(key: string, now: number): boolean };
}
