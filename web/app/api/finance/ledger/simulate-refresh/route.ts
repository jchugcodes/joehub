import { apiLimiter, store } from "../../../../../lib/store.mjs";
import { handleFinanceSimulateRefresh } from "../../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return jsonResult(await handleFinanceSimulateRefresh(request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)));
}
