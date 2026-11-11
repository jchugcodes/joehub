import { apiLimiter, store } from "../../../../../lib/store.mjs";
import { handleFinanceImportTransaction } from "../../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return jsonResult(await handleFinanceImportTransaction(request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request), request));
}
