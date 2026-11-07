import type { Metadata } from "next";
import { loadFixtures } from "../../lib/fixtures.mjs";
import { DataTable } from "../../lib/table";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  const data = loadFixtures();
  return (
    <main>
      {/* TODO: design handoff — jobs */}
      <h1>Jobs</h1>
      <DataTable
        caption="Applications"
        columns={["role_title", "company_name", "status", "applied_on", "raw_source"]}
        rows={data.applications}
      />
      <DataTable caption="Status counts" columns={["status", "total"]} rows={data.statuses} />
    </main>
  );
}
