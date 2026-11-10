"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FinanceTabs } from "../../../components/FinanceTabs";

type Account = { name: string; group: string; amountCents: number };
type Snapshot = { netWorthCents: number; assetsCents: number; liabilitiesCents: number; updatedAt: string; accounts: Account[] };

function money(cents: number, digits = true) {
  const abs = Math.abs(cents);
  const text = digits ? (abs / 100).toFixed(2) : String(Math.round(abs / 100));
  const [whole, frac] = text.split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
}

function stamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function AccountsPage() {
  const fromMore = useSearchParams().get("from") === "more";
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    void fetch("/api/finance/accounts", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        setSnapshot((await response.json()) as Snapshot);
      })
      .catch(() => setSnapshot(null));
  }, []);

  return (
    <main className="finance-type min-w-0 text-ink" data-from={fromMore ? "more" : "finance"} data-ready={snapshot ? "true" : undefined}>
      <header className="px-5 pt-2">
        {fromMore ? (
          <Link href="/more#accounts" className="inline-flex min-h-11 items-center pr-2 text-body">
            ‹ More
          </Link>
        ) : null}
        <p className="text-meta text-muted">joehub</p>
        <h1 className="text-title font-medium">Accounts</h1>
      </header>
      <div className="mt-3">
        <FinanceTabs />
      </div>
      {snapshot ? (
        <>
          <p className="mx-4 mt-3 text-meta text-muted">Updated {stamp(snapshot.updatedAt)}</p>
          <section className="mx-4 mt-3 rounded-[20px] border border-line p-4">
            <p className="text-meta text-muted">Net worth</p>
            <p className="mt-1 font-medium">
              <span className="text-title">{money(snapshot.netWorthCents, false).replace(/\.\d+$/, "")}</span>
              <span className="text-section">.{String(snapshot.netWorthCents % 100).padStart(2, "0")}</span>
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <p className="text-meta text-muted">
                Assets
                <span className="mt-1 block text-section font-medium text-ink">{money(snapshot.assetsCents)}</span>
              </p>
              <p className="text-meta text-muted">
                Liabilities
                <span className="mt-1 block text-section font-medium text-ink">{money(snapshot.liabilitiesCents)}</span>
              </p>
            </div>
          </section>
          <h2 className="mt-5 px-5 text-section font-medium">Included accounts</h2>
          <ul className="mt-2 space-y-2.5 px-4">
            {snapshot.accounts.map((account) => (
              <li key={account.name} className="flex items-center justify-between gap-3 rounded-[20px] border border-line p-4">
                <span>
                  <span className="block text-body font-medium">{account.name}</span>
                  <span className="block text-meta text-muted">{account.group}</span>
                </span>
                <span className="text-body font-medium">{money(account.amountCents)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="px-5 py-8 text-body text-muted">Loading accounts…</p>
      )}
    </main>
  );
}
