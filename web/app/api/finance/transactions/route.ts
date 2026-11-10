import { apiLimiter, store } from "../../../../lib/store.mjs";
import { handleFinanceTransactions } from "../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return jsonResult(await handleFinanceTransactions(request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)));
}
