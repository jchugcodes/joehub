import Link from "next/link";
import { FinanceTabs } from "../../../components/FinanceTabs";
import type { AccountBalance } from "../../../lib/contract";
import { loadFixtures } from "../../../lib/fixtures.mjs";

export default function AccountsPage() {
  const accounts = loadFixtures().accounts as AccountBalance[];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Finance</p>
      <h1 className="text-3xl font-semibold">Accounts</h1>
      <FinanceTabs />
      <p className="text-sm text-muted">This screen is not in the handoff. Amounts are the synthetic fixture balances, in cents.</p>
      <ul className="space-y-3">
        {accounts.map((account) => (
          <li key={account.id} className="rounded-2xl bg-card p-4 shadow-sm">
            <p className="font-semibold">{account.name}</p>
            <p className="text-sm text-muted">
              {account.account_type} · {account.institution}
            </p>
            <p className="mt-1 text-xl font-semibold">{account.balance_cents}</p>
          </li>
        ))}
      </ul>
      <Link href="/finance" className="text-sm font-semibold text-finance-text">
        Back to overview
      </Link>
    </div>
  );
}
