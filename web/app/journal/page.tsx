import type { Metadata } from "next";
import { loadFixtures } from "../../lib/fixtures.mjs";
import { DataTable } from "../../lib/table";

export const metadata: Metadata = { title: "Journal" };

export default function JournalPage() {
  const data = loadFixtures();
  return (
    <main>
      {/* TODO: design handoff — journal */}
      <h1>Journal</h1>
      <DataTable
        caption="Entries"
        columns={["entry_date", "title", "mood", "body"]}
        rows={data.entries}
      />
      <DataTable
        caption="Events"
        columns={["starts_at", "title", "location", "notes"]}
        rows={data.events}
      />
    </main>
  );
}
