import type { Metadata } from "next";
import { loadFixtures } from "../../lib/fixtures.mjs";
import { DataTable } from "../../lib/table";

export const metadata: Metadata = { title: "Finance" };

export default function FinancePage() {
  const data = loadFixtures();
  return (
    <main>
      {/* TODO: design handoff — finance */}
      <h1>Finance</h1>
      <p>Amounts are integer cents.</p>
      <DataTable
        caption="Accounts"
        columns={["name", "account_type", "institution", "balance_cents"]}
        rows={data.accounts}
      />
      <DataTable
        caption="Transactions"
        columns={["date", "payee", "account_name", "category_name", "amount_cents"]}
        rows={data.transactions}
      />
    </main>
  );
}
