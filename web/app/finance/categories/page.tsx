import { permanentRedirect } from "next/navigation";
import { spendingPath } from "../../../lib/spending-href.mjs";

export const dynamic = "force-dynamic";

export default async function CategoriesRedirect({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  permanentRedirect(spendingPath((await searchParams) || {}));
}
