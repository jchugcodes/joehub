import { permanentRedirect } from "next/navigation";
import { spendingPath } from "../../../../lib/spending-href.mjs";

export const dynamic = "force-dynamic";

export default async function CategoryRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  permanentRedirect(spendingPath((await searchParams) || {}, decodeURIComponent(slug)));
}
