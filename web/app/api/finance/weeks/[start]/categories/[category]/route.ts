import { apiLimiter, store } from "../../../../../../../lib/store.mjs";
import { handleFinanceCategory } from "../../../../../../../lib/api.mjs";
import { clientIp, jsonResult } from "../../../../../../../lib/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ start: string; category: string }> }) {
  const { start, category } = await context.params;
  return jsonResult(
    await handleFinanceCategory(
      request.headers,
      process.env,
      store,
      apiLimiter,
      Date.now(),
      clientIp(request),
      request.url,
      start,
      category,
    ),
  );
}
