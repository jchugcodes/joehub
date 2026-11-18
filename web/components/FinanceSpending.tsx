"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { countsAsSpend, money, spendCents } from "../lib/finance.mjs";
import { showMonthBudget } from "../lib/live-pages.mjs";
import { readOverlayHold } from "../lib/overlay-motion.mjs";
import { readSkeletonHold } from "../lib/skeleton-gate.mjs";
import { CategoryMark } from "./CategoryMark";
import { FinanceTabs } from "./FinanceTabs";
import { Icon } from "./Icon";
import { useOverlayHolds, useOverlays, useProductionNav, useSkeletonHolds, useSkeletons } from "./LivePages";
import { OverlayPanel } from "./OverlayPanel";
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

type Txn = {
  id: string;
  payee: string;
  amountCents: number;
  date: string;
  category: string | null;
  type: string;
  meta: string;
  corrected: boolean;
  uncategorized: boolean;
  accountMask?: string;
  note?: string;
};

type WeekPage = {
  weekStart: string;
  today: string;
  previousWeek: string;
  rows: Txn[];
};

function txnMoney(cents: number) {
  const sign = cents < 0 ? "−" : cents > 0 ? "+" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function dayText(ymd: string) {
  const parsed = new Date(`${ymd}T12:00:00-05:00`);
  if (Number.isNaN(parsed.getTime())) return ymd;
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Detroit", weekday: "short", month: "short", day: "numeric" }).format(parsed);
}

function hrefFor(search: URLSearchParams, patch: (next: URLSearchParams) => void) {
  const next = new URLSearchParams(search.toString());
  patch(next);
  const query = next.toString();
  return query ? `/finance/spending?${query}` : "/finance/spending";
}

export function FinanceSpending() {
  const router = useRouter();
  const search = useSearchParams();
  const asOf = search.get("asOf") || "";
  const selectedId = search.get("txn") || "";
  const requested = search.get("category") || "";
  const production = useProductionNav();
  const skeletonOn = useSkeletons();
  const holdsOn = useSkeletonHolds();
  const hold = readSkeletonHold(search, holdsOn);
  const overlayOn = useOverlays();
  const overlayHold = readOverlayHold(search, useOverlayHolds());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [month, setMonth] = useState<Month | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [failed, setFailed] = useState(false);
  const [tone, setTone] = useState("");
  const [wide, setWide] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draftCategory, setDraftCategory] = useState("");
  const [transfer, setTransfer] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = !snapshot && !failed && hold !== "refresh" && hold !== "empty" && hold !== "error" && hold !== "skel";
  const { phase, refreshing } = useSkeletonPhase(skeletonOn, hold, pending, Boolean(snapshot) || hold === "refresh" || hold === "empty");
  const bones = skeletonOn && (hold === "skel" || (phase === "skeleton" && !snapshot));
  const offline = tone === "offline";
  const panelOffline = overlayHold === "offline" || offline;
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
    const collected: Txn[] = [];
    const seen = new Set<string>();
    let week = "";
    for (let step = 0; step < 8; step += 1) {
      const query = new URLSearchParams();
      if (asOf) query.set("asOf", asOf);
      if (week) query.set("week", week);
      const response = await fetch(`/api/finance/transactions?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("transactions");
      const page = (await response.json()) as WeekPage;
      const monthStart = `${page.today.slice(0, 7)}-01`;
      for (const row of page.rows) {
        if (seen.has(row.id) || row.date < monthStart || row.date > page.today || !countsAsSpend(row)) continue;
        seen.add(row.id);
        collected.push(row);
      }
      if (!page.previousWeek || page.weekStart <= monthStart) break;
      week = page.previousWeek;
    }
    collected.sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0));
    setSnapshot(body);
    setMonth(monthBody);
    setTxns(collected);
    setFailed(false);
  }, [asOf]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const apply = () => setWide(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

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

  function go(patch: (next: URLSearchParams) => void) {
    router.push(hrefFor(search, patch), { scroll: false });
  }

  const rows = (snapshot?.categories || [])
    .filter((item) => item.spentCents > 0)
    .sort((left, right) => right.spentCents - left.spentCents || (left.name < right.name ? -1 : 1));
  const spent = snapshot?.spentCents ?? 0;
  const listSpent = txns.reduce((sum, row) => sum + spendCents(row), 0);
  const planOn = showMonthBudget(production, month);
  const showBody = !bones && !showError && !showEmptyHold && Boolean(snapshot);
  const active = rows.some((item) => item.slug === requested) ? requested : "";
  const visible = txns.filter((row) => !active || (active === "uncategorized" ? !row.category : row.category === active));
  const selected = txns.find((row) => row.id === selectedId) || null;
  const activeName = rows.find((item) => item.slug === active)?.name || "";
  const nextType = transfer ? "transfer" : selected?.type === "refund" ? "refund" : "expense";
  const nextCategory = transfer ? null : draftCategory || null;
  const changed = Boolean(selected) && (nextType !== selected?.type || nextCategory !== (selected?.category || null));
  const canSave = changed && !saving && !panelOffline;
  const categoryChoices = (snapshot?.categories || []).filter((item) => item.slug !== "uncategorized");

  useEffect(() => {
    setEditing(false);
    setError("");
    setSaving(false);
  }, [selectedId]);

  function openEdit() {
    if (!selected || panelOffline) return;
    setDraftCategory(selected.category || "");
    setTransfer(selected.type === "transfer");
    setError("");
    setEditing(true);
  }

  function closeEdit() {
    setEditing(false);
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canSave || !selected) return;
    setSaving(true);
    setError("");
    const leaving = nextType === "transfer";
    try {
      const response = await fetch(`/api/finance/transactions/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payee: selected.payee,
          amountCents: selected.amountCents,
          date: selected.date,
          type: nextType,
          category: nextCategory,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { detail?: string };
      if (!response.ok) {
        setError(body.detail || "Couldn’t save.");
        return;
      }
      await load();
      setEditing(false);
      if (leaving) go((next) => next.delete("txn"));
    } catch {
      setError("Couldn’t save.");
    } finally {
      setSaving(false);
    }
  }

  function categoryName(slug: string | null) {
    if (!slug) return "Uncategorized";
    return snapshot?.categories.find((item) => item.slug === slug)?.name || slug;
  }

  const detail = selected ? (
    <>
      <p className={`text-title font-medium tabular-nums ${selected.amountCents > 0 ? "text-finance-primary" : "text-ink"}`}>{txnMoney(selected.amountCents)}</p>
      <dl className="card mt-4 divide-y divide-line">
        <div className="flex min-h-11 items-center justify-between gap-4 px-4">
          <dt className="text-muted">Date</dt>
          <dd className="font-medium">{dayText(selected.date)}</dd>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-4 px-4">
          <dt className="text-muted">Category</dt>
          <dd className="flex items-center gap-2 font-medium">
            <CategoryMark category={selected.uncategorized ? "uncategorized" : selected.category} type={selected.type} />
            {categoryName(selected.category)}
          </dd>
        </div>
        {selected.accountMask && /^\d{4}$/.test(selected.accountMask) ? (
          <div className="flex min-h-11 items-center justify-between gap-4 px-4">
            <dt className="text-muted">Account</dt>
            <dd className="font-medium tabular-nums">•••• {selected.accountMask}</dd>
          </div>
        ) : null}
        {selected.note ? (
          <div className="flex min-h-11 items-center justify-between gap-4 px-4">
            <dt className="text-muted">Note</dt>
            <dd className="font-medium">{selected.note}</dd>
          </div>
        ) : null}
      </dl>
    </>
  ) : (
    <p className="text-body text-ink">That transaction is not here.</p>
  );

  const editForm = selected ? (
    <form id="spending-form" data-edit="open" onSubmit={save} className="space-y-3">
      <p data-edit-context className="truncate text-meta text-muted">
        {selected.payee} · {txnMoney(selected.amountCents)}
      </p>
      <button
        type="button"
        data-autofocus
        aria-pressed={transfer}
        className={`min-h-11 min-w-11 rounded-full px-3 text-body ${transfer ? "bg-ink text-page" : "border border-line text-ink"}`}
        onClick={() => setTransfer((value) => !value)}
      >
        Transfer
      </button>
      {transfer ? null : (
        <div className="flex flex-col">
          {categoryChoices.map((item) => {
            const pressed = draftCategory === item.slug;
            return (
              <button
                key={item.slug}
                type="button"
                aria-pressed={pressed}
                aria-label={`Category ${item.name}`}
                className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left text-body font-medium text-ink ${pressed ? "row-selected" : ""}`}
                onClick={() => {
                  setTransfer(false);
                  setDraftCategory(item.slug);
                }}
              >
                <CategoryMark category={item.slug} />
                {item.name}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={!draftCategory}
            aria-label="Category Uncategorized"
            className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left text-body font-medium text-ink ${!draftCategory ? "row-selected" : ""}`}
            onClick={() => {
              setTransfer(false);
              setDraftCategory("");
            }}
          >
            <CategoryMark category="uncategorized" />
            Uncategorized
          </button>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-body text-finance-dining">
          {error}
        </p>
      ) : null}
    </form>
  ) : null;

  const panelBody = (
    <div className="px-5 py-4 text-left text-body text-ink" data-txn-detail="true">
      {overlayHold === "error" ? (
        <p role="alert" className="text-body text-ink">Couldn’t load that transaction.</p>
      ) : editing ? (
        editForm
      ) : (
        detail
      )}
      {panelOffline ? (
        <p role="status" data-state="offline" className="mt-4 rounded-2xl bg-table-header px-4 py-3 text-left text-body text-ink dark:bg-white/10">
          You are offline.
        </p>
      ) : null}
    </div>
  );

  const panel = (panelWide: boolean) =>
    selectedId ? (
      <OverlayPanel
        wide={panelWide}
        title={editing ? "Edit transaction" : selected?.payee || "Transaction"}
        onClose={() => {
          setEditing(false);
          setError("");
          go((next) => next.delete("txn"));
        }}
        onBack={editing ? closeEdit : undefined}
        form={editing}
        slim={editing}
        sheet={editing}
        action={
          editing ? (
            <button type="submit" form="spending-form" disabled={!canSave} className="inline-flex h-11 min-w-11 items-center justify-center bg-transparent p-0 disabled:opacity-50">
              <span className="inline-flex h-8 items-center justify-center rounded-xl bg-ink px-3.5 text-body font-medium text-page">Save</span>
            </button>
          ) : selected ? (
            <button type="button" disabled={panelOffline} onClick={openEdit} className={`inline-flex h-11 items-center px-2 text-body font-medium ${panelOffline ? "text-muted opacity-50" : "text-finance-primary"}`}>
              Edit
            </button>
          ) : null
        }
      >
        {panelBody}
      </OverlayPanel>
    ) : null;

  return (
    <main className="finance-type min-w-0 text-ink" data-ready={snapshot && !bones ? "true" : undefined} data-spending={rows.length ? "list" : snapshot ? "empty" : "loading"} data-plan={planOn ? (month?.saved ? "plan" : "estimate") : "none"} data-layout={wide ? "panel" : "sheet"}>
      <header className="px-5 pt-2">
        <p className="text-meta text-muted">joehub</p>
        <h1 className="text-title font-medium">Finance</h1>
      </header>
      <div className="mt-3">
        <FinanceTabs />
      </div>
      <div className={wide && overlayOn && selectedId ? "flex min-w-0 items-start" : "min-w-0"}>
        <div className="min-w-0 flex-1">
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
              <section className="mx-5 mt-5 rounded-[22px] border border-line px-4 py-4" data-month-spent={spent}>
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
              {rows.length ? (
                <section className="mt-2" data-list-spent={listSpent} data-filter={active || "all"}>
                  <div className="finance-tab-row w-full min-w-0 overflow-x-auto" role="group" aria-label="Category">
                    <div className="flex w-max min-w-full gap-4 px-5">
                      {[{ slug: "", name: "All" }, ...rows].map((item) => {
                        const pressed = (item.slug || "") === active;
                        return (
                          <button
                            key={item.slug || "all"}
                            type="button"
                            aria-pressed={pressed}
                            className={`min-h-11 min-w-11 shrink-0 border-b-[2.5px] px-1 text-body text-ink ${pressed ? "border-accent font-semibold" : "border-transparent font-medium"}`}
                            onClick={() => go((next) => (item.slug ? next.set("category", item.slug) : next.delete("category")))}
                          >
                            {item.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <h2 className="mt-4 px-5 text-section font-medium">Transactions</h2>
                  {visible.length ? (
                    <ul className="px-5">
                      {visible.map((row) => (
                        <li key={row.id}>
                          <button
                            type="button"
                            data-txn={row.id}
                            aria-current={overlayOn && row.id === selectedId ? "true" : undefined}
                            className={`flex min-h-11 w-full items-center gap-3 border-b border-line py-2.5 text-left text-ink hover:text-ink focus:text-ink ${overlayOn && row.id === selectedId ? "row-selected" : ""}`}
                            onClick={() => go((next) => next.set("txn", row.id))}
                          >
                            <CategoryMark category={row.uncategorized ? "uncategorized" : row.category} type={row.type} />
                            <span className="min-w-0 flex-1">
                              <span className="block text-body font-medium">{row.payee}</span>
                              <span className="block text-meta text-muted">
                                {row.meta}
                                {row.corrected ? <span className="ml-1 rounded bg-finance-primary/15 px-1.5 py-0.5 text-meta font-medium text-finance-primary">Corrected</span> : null}
                                {row.uncategorized && !row.meta.includes("Uncategorized") ? <span className="ml-1 rounded bg-table-header px-1.5 py-0.5 text-meta font-medium text-muted">Uncategorized</span> : null}
                              </span>
                            </span>
                            <span className={`text-body font-medium ${row.amountCents > 0 ? "text-finance-primary" : ""}`}>{txnMoney(row.amountCents)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-5 py-16 text-center text-body" data-state="empty">No {activeName} this month.</p>
                  )}
                </section>
              ) : null}
            </>
          ) : null}
        </div>
        {overlayOn && wide && selectedId ? panel(true) : null}
      </div>
      {overlayOn && !wide && selectedId ? panel(false) : null}
    </main>
  );
}
