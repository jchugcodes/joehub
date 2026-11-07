import { loginLimiter, store } from "../../../../lib/store.mjs";
import { handleLogin } from "../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const text = await request.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      return jsonResult({ status: 400, body: { detail: "malformed auth" } });
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResult({ status: 400, body: { detail: "malformed auth" } });
  }
  const record = body as { username?: unknown; password?: unknown };
  if (typeof record.username !== "string" || typeof record.password !== "string") {
    return jsonResult({ status: 400, body: { detail: "malformed auth" } });
  }
  return jsonResult(
    await handleLogin(body, process.env, store, loginLimiter, Date.now(), clientIp(request)),
  );
}
