import { handleIngest, withIngestHeaders } from "../../../../lib/ingest.mjs";
import { jsonResult } from "../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ entity: string }> }) {
  const { entity } = await context.params;
  const rawBody = await request.text();
  try {
    const result = await handleIngest({
      entity,
      rawBody,
      headers: request.headers,
      env: process.env,
      now: Date.now(),
    });
    const status = typeof result.status === "number" ? result.status : 503;
    const body = result.body ?? { detail: "unavailable" };
    return withIngestHeaders(jsonResult({ status, body }), result);
  } catch {
    return jsonResult({ status: 503, body: { detail: "unavailable" } });
  }
}
