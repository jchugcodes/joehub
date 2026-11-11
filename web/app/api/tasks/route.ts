import { apiLimiter, store } from "../../../lib/store.mjs";
import { handleTasksGet, handleTasksPost } from "../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../lib/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return jsonResult(
    await handleTasksGet(request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request), request.url),
  );
}

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  return jsonResult(
    await handleTasksPost(body, request.headers, process.env, store, apiLimiter, Date.now(), clientIp(request)),
  );
}
