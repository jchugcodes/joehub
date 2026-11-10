import { apiLimiter, store } from "../../../lib/store.mjs";
import { handleGroceryGet, handleGroceryPost } from "../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../lib/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return jsonResult(await handleGroceryGet(request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)));
}

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  return jsonResult(await handleGroceryPost(body, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)));
}
