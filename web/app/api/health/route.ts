import { jsonResult } from "../../../lib/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  return jsonResult({ status: 200, body: { ok: true } });
}
