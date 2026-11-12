import { apiLimiter, store } from "../../../../lib/store.mjs";
import { handleFinanceCreateGoal, handleFinanceGoals } from "../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return jsonResult(await handleFinanceGoals(request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)));
}

export async function POST(request: Request) {
  return jsonResult(await handleFinanceCreateGoal(request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request), request));
}
