"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { FinanceTabs } from "../../../components/FinanceTabs";

const accounts = [
  { name: "Example checking", meta: "Cash · synthetic snapshot", amount: "$2,472.36", icon: "finance", tint: "bg-finance-primary/10 text-finance-primary" },
  { name: "Example savings", meta: "Cash · synthetic snapshot", amount: "$10,000.00", icon: "income", tint: "bg-finance-primary/10 text-finance-primary" },
  { name: "Example brokerage", meta: "Investments · synthetic snapshot", amount: "$14,000.00", icon: "trend", tint: "bg-jobs/10 text-jobs" },
  { name: "Example loan", meta: "Liability · synthetic snapshot", amount: "$7,600.00", icon: "subscriptions", tint: "bg-finance-dining/10 text-finance-dining" },
  { name: "Example card", meta: "Liability · synthetic snapshot", amount: "$400.00", icon: "finance", tint: "bg-finance-dining/10 text-finance-dining" },
];

export default function AccountsPage() {
  const empty = useSearchParams().get("view") === "empty";
  return (
    <div className="min-w-0">
      <header className="px-5">
        <p className="text-ui-13 text-muted">Finance</p>
        <h1 className="text-ui-22 font-bold">Accounts</h1>
      </header>
      <div className="mt-4">
        <FinanceTabs />
      </div>
      {empty ? (
        <>
          <p className="mx-4 mt-4 rounded-xl border border-line bg-white p-3 text-ui-12 text-ink">SYNTHETIC EMPTY STATE · No data is connected. Demo only. Nothing was saved.</p>
          <section className="card mx-4 mt-5 p-4">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-finance-primary/10 text-finance-primary">
              <Icon name="finance" size={24} />
            </span>
            <h2 className="mt-4 text-ui-22 font-bold">No accounts to show</h2>
            <p className="mt-2 text-ui-14 text-muted">Balances appear after an account snapshot is available. An empty list does not mean your net worth is $0.</p>
            <Link
              href="/finance"
              className="mt-4 flex min-h-12 items-center justify-center rounded-xl border border-finance-primary px-4 text-ui-19 font-bold text-finance-primary"
            >
              Back to overview
            </Link>
          </section>
        </>
      ) : (
        <>
          <p className="mx-4 mt-4 rounded-xl border border-line bg-white p-3 text-ui-12 text-ink">
            SYNTHETIC · No live connection or account actions. Demo only. Nothing was saved.
          </p>
          <section className="card mx-4 mt-4 p-4">
            <p className="text-ui-13 text-muted">Net worth · example</p>
            <p className="mt-1 text-[2rem] font-extrabold tabular-nums">
              $18,472<span className="text-ui-20">.36</span>
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-ui-12 text-muted">
              <p>
                Assets
                <span className="mt-1 block text-ui-16 font-bold text-ink">$26,472.36</span>
              </p>
              <p>
                Liabilities
                <span className="mt-1 block text-ui-16 font-bold text-ink">$8,000.00</span>
              </p>
            </div>
          </section>
          <h2 className="mt-5 px-5 text-ui-17 font-bold">Included accounts</h2>
          <ul className="mt-2 space-y-2.5 px-4">
            {accounts.map((account) => (
              <li key={account.name} className="card p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${account.tint}`}>
                    <Icon name={account.icon} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-ui-15 font-semibold">{account.name}</span>
                    <span className="block text-ui-12 text-muted">{account.meta}</span>
                  </span>
                  <span className="text-ui-15 font-semibold tabular-nums">{account.amount}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 px-5 text-ui-12 text-ink">
            Goal allocations are part of these balances, not additional assets. No account numbers, linking or payment actions are included.
          </p>
        </>
      )}
      <p className="mb-4 mt-6 text-center text-ui-10 text-muted">SYNTHETIC DATA · design reference</p>
    </div>
  );
}
