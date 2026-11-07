import { loginLimiter, store } from "../../../../lib/store.mjs";
import { handleLogin } from "../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return jsonResult(
    handleLogin(body, process.env, store, loginLimiter, Date.now(), clientIp(request)),
  );
}
