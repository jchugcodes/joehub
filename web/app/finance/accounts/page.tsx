import Link from "next/link";
import { FinanceTabs } from "../../../components/FinanceTabs";
import type { AccountBalance } from "../../../lib/contract";
import { loadFixtures } from "../../../lib/fixtures.mjs";

export default function AccountsPage() {
  const accounts = loadFixtures().accounts as AccountBalance[];
  return (
    <div className="space-y-4">
      <p className="px-5 text-sm text-muted">Finance</p>
      <h1 className="px-5 text-ui-22 font-bold">Accounts</h1>
      <FinanceTabs />
      <p className="px-4 text-sm text-muted">This screen is not in the handoff. Amounts are the synthetic fixture balances, in cents.</p>
      <ul className="space-y-3 px-4">
        {accounts.map((account) => (
          <li key={account.id} className="card p-4">
            <p className="font-semibold">{account.name}</p>
            <p className="text-sm text-muted">
              {account.account_type} · {account.institution}
            </p>
            <p className="mt-1 text-xl font-semibold">{account.balance_cents}</p>
          </li>
        ))}
      </ul>
      <Link href="/finance" className="px-4 text-sm font-semibold text-finance-primary">
        Back to overview
      </Link>
    </div>
  );
}
