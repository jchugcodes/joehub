import { apiLimiter, store } from "../../../../lib/store.mjs";
import { handleFinanceCreateTransaction, handleFinanceTransactions } from "../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return jsonResult(await handleFinanceTransactions(request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request), request.url));
}

export async function POST(request: Request) {
  return jsonResult(await handleFinanceCreateTransaction(request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request), request));
}
