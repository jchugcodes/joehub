import { apiLimiter, store } from "../../../../lib/store.mjs";
import { handleGroceryItemDelete, handleGroceryItemGet, handleGroceryItemPatch } from "../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return jsonResult(await handleGroceryItemGet(id, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)));
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  return jsonResult(await handleGroceryItemPatch(id, body, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)));
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return jsonResult(await handleGroceryItemDelete(id, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)));
}
