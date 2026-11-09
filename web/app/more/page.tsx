"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Icon } from "../../components/Icon";

function DatabaseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M3 15h18M9 4v16" />
    </svg>
  );
}

export default function MorePage() {
  useEffect(() => {
    const focusHash = () => {
      const id = window.location.hash.replace("#", "");
      if (id === "database" || id === "accounts") document.getElementById(`more-${id}`)?.focus();
    };
    focusHash();
    window.addEventListener("hashchange", focusHash);
    return () => window.removeEventListener("hashchange", focusHash);
  }, []);

  return (
    <div data-ready="true" className="min-w-0">
      <header className="px-5 pt-3">
        <p className="text-ui-13 text-[#46544B]">joehub</p>
        <h1 className="text-ui-22 font-bold">More</h1>
        <p className="mt-2 text-ui-13 leading-relaxed text-[#46544B]">Your secondary views, in one place.</p>
      </header>
      <div className="mt-5 space-y-3 px-4">
        <Link id="more-tasks" href="/tasks" className="card flex min-h-24 items-center gap-3 p-4">
          <Icon name="check" size={22} />
          <span className="min-w-0 flex-1">
            <span className="block text-ui-16 font-semibold">Tasks</span>
            <span className="mt-1 block text-ui-12 leading-snug text-muted">Unfinished tasks, newest first</span>
          </span>
          <Icon name="chevron" size={20} className="shrink-0 text-muted" />
        </Link>
        <Link id="more-database" href="/more/database" className="card flex min-h-24 items-center gap-3 p-4">
          <DatabaseIcon />
          <span className="min-w-0 flex-1">
            <span className="block text-ui-16 font-semibold">Database</span>
            <span className="mt-1 block text-ui-12 leading-snug text-muted">Transactions, jobs, journal, dates and goals</span>
          </span>
          <Icon name="chevron" size={20} className="shrink-0 text-muted" />
        </Link>
        <Link id="more-accounts" href="/finance/accounts?from=more" className="card flex min-h-24 items-center gap-3 p-4 text-finance-primary">
          <Icon name="finance" size={22} />
          <span className="min-w-0 flex-1 text-ink">
            <span className="block text-ui-16 font-semibold">Accounts</span>
            <span className="mt-1 block text-ui-12 leading-snug text-muted">Open Finance → Accounts · read-only balances</span>
          </span>
          <Icon name="chevron" size={20} className="shrink-0 text-muted" />
        </Link>
        <div className="card flex min-h-24 items-center gap-3 p-4">
          <Icon name="more" size={22} />
          <span className="min-w-0 flex-1">
            <span className="block text-ui-16 font-semibold">Appearance</span>
            <span className="mt-1 block text-ui-12 leading-snug text-muted">Planned · settings are not available in this slice</span>
          </span>
          <span className="self-start rounded-md bg-line px-1.5 py-1 text-ui-10 font-medium text-ink">Planned</span>
        </div>
        <div className="card flex min-h-24 items-center gap-3 p-4">
          <Icon name="subscriptions" size={22} />
          <span className="min-w-0 flex-1">
            <span className="block text-ui-16 font-semibold">Sync status</span>
            <span className="mt-1 block text-ui-12 leading-snug text-muted">Planned · connection details are not available yet</span>
          </span>
          <span className="self-start rounded-md bg-line px-1.5 py-1 text-ui-10 font-medium text-ink">Planned</span>
        </div>
        <p className="rounded-xl border border-subtle-border bg-white p-3 text-ui-13 leading-relaxed">
          <span className="font-bold">Database is an inspection view.</span>
          <br />
          Start with Transactions. Other database collections are planned, not active destinations.
        </p>
        <p className="rounded-xl border border-subtle-border bg-white p-3 text-ui-13 leading-relaxed">
          <span className="font-bold">Accounts stays in Finance.</span>
          <br />
          Open balances from here, then return to More. No sixth primary tab.
        </p>
        <p className="px-1 pt-2 text-ui-12 leading-relaxed text-[#46544B]">Example data only. Notion is the authoritative source when connected.</p>
      </div>
    </div>
  );
}
