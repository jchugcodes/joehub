import { apiLimiter, store } from "../../../../lib/store.mjs";
import { handleTaskDelete, handleTaskGet, handleTaskPatch } from "../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return jsonResult(
    await handleTaskGet(id, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)),
  );
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return jsonResult(await handleTaskDelete(id, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)));
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  return jsonResult(
    await handleTaskPatch(id, body, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)),
  );
}
