import { apiLimiter, store } from "../../../../lib/store.mjs";
import { handleLogout } from "../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return jsonResult(
    await handleLogout(request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)),
  );
}
