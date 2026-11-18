"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { money } from "../lib/finance.mjs";
import { showMonthBudget } from "../lib/live-pages.mjs";
import { readSkeletonHold } from "../lib/skeleton-gate.mjs";
import { CategoryMark } from "./CategoryMark";
import { FinanceTabs } from "./FinanceTabs";
import { Icon } from "./Icon";
import { useProductionNav, useSkeletonHolds, useSkeletons } from "./LivePages";
import { useSkeletonPhase } from "./SkeletonHold";
import { LoadError, RefreshBar, SpendingSkeleton } from "./Skeleton";

type Month = {
  label?: string;
  spentCents: number;
  planCents: number | null;
  percent: number | null;
  saved?: boolean;
};

type CategoryRow = {
  slug: string;
  name: string;
  color?: string;
  spentCents: number;
};

type Snapshot = {
  label: string;
  spentCents: number;
  categories: CategoryRow[];
};

export function FinanceSpending() {
  const search = useSearchParams();
  const asOf = search.get("asOf") || "";
  const production = useProductionNav();
  const skeletonOn = useSkeletons();
  const holdsOn = useSkeletonHolds();
  const hold = readSkeletonHold(search, holdsOn);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [month, setMonth] = useState<Month | null>(null);
  const [failed, setFailed] = useState(false);
  const [tone, setTone] = useState("");
  const [revision, setRevision] = useState(0);
  const pending = !snapshot && !failed && hold !== "refresh" && hold !== "empty" && hold !== "error" && hold !== "skel";
  const { phase, refreshing } = useSkeletonPhase(skeletonOn, hold, pending, Boolean(snapshot) || hold === "refresh" || hold === "empty");
  const bones = skeletonOn && (hold === "skel" || (phase === "skeleton" && !snapshot));
  const offline = tone === "offline";
  const showError = !offline && ((skeletonOn && hold === "error") || (failed && !snapshot));
  const showEmptyHold = skeletonOn && hold === "empty";

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (asOf) params.set("asOf", asOf);
    params.set("period", "month");
    const overview = new URLSearchParams();
    if (asOf) overview.set("asOf", asOf);
    const [categoriesResponse, overviewResponse] = await Promise.all([
      fetch(`/api/finance/categories?${params.toString()}`, { cache: "no-store" }),
      fetch(`/api/finance/overview${overview.size ? `?${overview.toString()}` : ""}`, { cache: "no-store" }),
    ]);
    if (!categoriesResponse.ok) throw new Error("categories");
    const body = (await categoriesResponse.json()) as Snapshot;
    const monthBody = overviewResponse.ok ? (((await overviewResponse.json()) as { month?: Month }).month ?? null) : null;
    setSnapshot(body);
    setMonth(monthBody);
    setFailed(false);
  }, [asOf]);

  useEffect(() => {
    const onOffline = () => setTone("offline");
    const onOnline = () => setTone("");
    setTone(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "");
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    if (skeletonOn && (hold === "skel" || hold === "error")) return;
    let gone = false;
    void load().catch(() => {
      if (gone) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) setTone("offline");
      setFailed(true);
    });
    return () => {
      gone = true;
    };
  }, [load, revision, skeletonOn, hold]);

  function retry() {
    setFailed(false);
    setRevision((value) => value + 1);
  }

  const rows = (snapshot?.categories || [])
    .filter((item) => item.spentCents > 0)
    .sort((left, right) => right.spentCents - left.spentCents || (left.name < right.name ? -1 : 1));
  const spent = snapshot?.spentCents ?? 0;
  const planOn = showMonthBudget(production, month);
  const showBody = !bones && !showError && !showEmptyHold && Boolean(snapshot);

  return (
    <main className="finance-type min-w-0 text-ink" data-ready={snapshot && !bones ? "true" : undefined} data-spending={rows.length ? "list" : snapshot ? "empty" : "loading"} data-plan={planOn ? (month?.saved ? "plan" : "estimate") : "none"}>
      <header className="px-5 pt-2">
        <p className="text-meta text-muted">joehub</p>
        <h1 className="text-title font-medium">Finance</h1>
      </header>
      <div className="mt-3">
        <FinanceTabs />
      </div>
      {skeletonOn && refreshing && snapshot ? <RefreshBar /> : null}
      {offline ? (
        <p role="status" data-state="offline" className="mx-5 mt-3 rounded-2xl bg-table-header px-4 py-3 text-left text-body text-ink dark:bg-white/10">
          You are offline.
        </p>
      ) : null}
      {bones ? <SpendingSkeleton /> : null}
      {showError ? <LoadError onRetry={retry} /> : null}
      {showEmptyHold ? <p className="px-5 py-16 text-center text-body" data-state="empty">No spending this month.</p> : null}
      {showBody ? (
        <>
          <section className="mx-5 mt-5 rounded-[22px] border border-line px-4 py-4">
            <div className="flex items-baseline justify-between gap-3 text-meta">
              <p className="font-medium text-ink">Spent this month</p>
              {month?.label ? <p className="text-muted">{month.label}</p> : null}
            </div>
            <p className="mt-1 font-medium text-ink">
              <span className="text-title">{money(spent)}</span>
              {planOn && month?.planCents != null ? <span className="text-body font-normal text-muted"> of {money(month.planCents)} {month.saved ? "plan" : "estimate"}</span> : null}
            </p>
            {planOn && month?.percent != null ? <p className="mt-2 text-meta text-muted">{month.percent}% used</p> : null}
          </section>
          {rows.length ? (
            <ul className="mt-4 px-4">
              {rows.map((item) => {
                const share = spent > 0 ? Math.max(1, Math.round((item.spentCents / spent) * 100)) : 0;
                const params = new URLSearchParams();
                params.set("period", "month");
                if (asOf) params.set("asOf", asOf);
                return (
                  <li key={item.slug}>
                    <Link href={`/finance/categories/${item.slug}?${params.toString()}`} className="flex min-h-11 items-center gap-3 px-1 py-3">
                      <CategoryMark category={item.slug} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-body font-medium">{item.name}</span>
                          <span className="shrink-0 text-body font-medium">{money(item.spentCents)}</span>
                        </span>
                        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-line">
                          <span className="block h-full rounded-full" style={{ width: `${share}%`, background: item.color || "var(--muted)" }} />
                        </span>
                      </span>
                      <Icon name="chevron" size={16} className="shrink-0 text-muted" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-16 text-center text-body" data-state="empty">No spending this month.</p>
          )}
        </>
      ) : null}
    </main>
  );
}
