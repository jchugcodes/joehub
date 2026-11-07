import Link from "next/link";
import { notFound } from "next/navigation";
import { journal } from "../../../lib/design-fixtures";

export default async function JournalEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = journal.entries.find((item) => item.slug === slug);
  if (!entry) notFound();

  return (
    <div data-ready="true">
      <header className="px-5">
        <p className="text-ui-13 text-ink">Journal</p>
        <h1 className="text-ui-22 font-bold">{entry.title}</h1>
        <p className="mt-2 text-ui-13 text-ink">{entry.detailDate}</p>
      </header>
      <div className="mt-5 px-4">
        <article className="card p-4 text-left">
          <h2 className="text-ui-20 font-bold">{entry.lead}</h2>
          {entry.kind === "date" ? <p className="mt-3 text-ui-14 font-semibold text-ink">{entry.rating}</p> : null}
          <p className="mt-4 text-ui-15 leading-relaxed text-ink">{entry.body}</p>
          <p className="mt-5 border-t border-line pt-4 text-ui-13 text-ink">{entry.kindLabel}</p>
        </article>
        <Link href={`/journal#${entry.slug}`} className="action-link action-link-secondary mt-4">
          Back to journal
        </Link>
        <p className="mt-4 text-ui-13 text-ink">No edit, delete, share or scheduling action in this slice.</p>
      </div>
    </div>
  );
}
