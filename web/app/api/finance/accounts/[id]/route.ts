import { apiLimiter, store } from "../../../../../lib/store.mjs";
import { handleFinanceAccount, handleFinanceDeleteAccount, handleFinancePatchAccount } from "../../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return jsonResult(await handleFinanceAccount(id, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request), request.url));
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return jsonResult(await handleFinancePatchAccount(id, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request), request));
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return jsonResult(await handleFinanceDeleteAccount(id, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)));
}
