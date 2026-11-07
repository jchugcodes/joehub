import { handleRevokeAll } from "../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../lib/respond";
import { apiLimiter, store } from "../../../../lib/store.mjs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return jsonResult(
    await handleRevokeAll(request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)),
  );
}
