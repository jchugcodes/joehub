import { apiLimiter, store } from "../../../../../lib/store.mjs";
import { handleFinanceDeleteCategory, handleFinancePatchCategory } from "../../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return jsonResult(await handleFinancePatchCategory(slug, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request), request));
}

export async function DELETE(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return jsonResult(await handleFinanceDeleteCategory(slug, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)));
}
