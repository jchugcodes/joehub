import { apiLimiter, store } from "../../../../../lib/store.mjs";
import { handleFinanceBill, handleFinanceDeleteBill, handleFinancePatchBill } from "../../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return jsonResult(await handleFinanceBill(id, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request), request.url));
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return jsonResult(await handleFinancePatchBill(id, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request), request));
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return jsonResult(await handleFinanceDeleteBill(id, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)));
}
