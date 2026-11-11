import { apiLimiter, store } from "../../../../../lib/store.mjs";
import { handleFinancePatchTransaction, handleFinanceTransaction } from "../../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return jsonResult(await handleFinanceTransaction(id, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)));
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return jsonResult(await handleFinancePatchTransaction(id, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request), request));
}
