import { apiLimiter, store } from "../../../../lib/store.mjs";
import { handleListDelete, handleListPatch } from "../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  return jsonResult(await handleListPatch(id, body, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)));
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return jsonResult(await handleListDelete(id, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)));
}
