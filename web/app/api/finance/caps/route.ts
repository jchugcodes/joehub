import { apiLimiter, store } from "../../../../lib/store.mjs";
import { handleFinanceCaps } from "../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  return jsonResult(await handleFinanceCaps(request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request), request));
}
