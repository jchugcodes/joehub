"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { readOverlayHold } from "../lib/overlay-motion.mjs";
import { CategoryMark } from "./CategoryMark";
import { FinanceTabs } from "./FinanceTabs";
import { Icon } from "./Icon";
import { useOverlayHolds, useOverlays } from "./LivePages";
import { OverlayPanel } from "./OverlayPanel";
import { LoadError, TextLine } from "./Skeleton";
import { Sheet } from "./Sheet";

type Item = {
  slug: string;
  name: string;
  color: string;
  spentCents: number;
  capCents: number | null;
  estimate?: boolean;
  percent: number | null;
  fill: number;
  tone: string;
  status: string;
};

type Snapshot = {
  period: "month" | "week";
  weekStart: string;
  label: string;
  aside: string;
  spentCents: number;
  budgetCents: number;
  budgetLabel: string;
  categories: Item[];
};

type Row = {
  id: string;
  payee: string;
  amountCents: number;
  week: string;
  date?: string;
  meta: string;
};

export type CategoryDetail = Item & {
  period: "month" | "week";
  weekStart: string;
  label: string;
  daysLeft: number | null;
  rows: Row[];
};

function money(cents: number, digits?: boolean) {
  const abs = Math.abs(cents);
  const show = digits == null ? abs % 100 !== 0 : digits;
  const text = show ? (abs / 100).toFixed(2) : String(Math.round(abs / 100));
  const [whole, frac] = text.split(".");
  return `${cents < 0 ? "−" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
}

function signed(cents: number) {
  const text = money(Math.abs(cents), true);
  if (cents > 0) return `+${text}`;
  if (cents < 0) return `−${text}`;
  return text;
}

function dollars(cents: number) {
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

function parseBudget(value: string) {
  const text = value.trim();
  if (text === "") return { ok: true as const, cents: null };
  if (text.startsWith("-") || text.startsWith("−")) return { ok: false as const, cents: null, detail: "Can’t be negative." };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false as const, cents: null, detail: "Enter an amount." };
  return { ok: true as const, cents: Math.round(Number(text) * 100) };
}

function toneColor(item: { tone: string; color: string }) {
  if (item.tone === "over") return "#E07A5F";
  if (item.tone === "category") return item.color;
  return "#6B746E";
}

function budgetMeta(item: { spentCents: number; capCents: number | null; estimate?: boolean }) {
  const spent = money(item.spentCents);
  if (!item.capCents) return spent;
  return `${spent} of ${money(item.capCents)}${item.estimate ? " estimate" : ""}`;
}

function rowWhen(meta: string) {
  return meta.split(" · ")[0]?.trim() || "";
}

export function FinanceCategory({ slug }: { slug?: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const explicit = search.get("period");
  const period = explicit === "week" || explicit === "month" ? explicit : search.get("week") ? "week" : "month";
  const fromOverview = Boolean(slug) && explicit == null && Boolean(search.get("week"));
  const [wide, setWide] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [category, setCategory] = useState<CategoryDetail | null>(null);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [budgetError, setBudgetError] = useState("");
  const [budgetField, setBudgetField] = useState("");
  const [saving, setSaving] = useState(false);
  const [txnId, setTxnId] = useState("");
  const [offline, setOffline] = useState(false);
  const idempotency = useRef("");
  const overlayOn = useOverlays();
  const overlayHold = readOverlayHold(search, useOverlayHolds());

  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onOffline = () => setOffline(true);
    const onOnline = () => setOffline(false);
    setOffline(typeof navigator !== "undefined" && !navigator.onLine);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search.get("asOf")) params.set("asOf", search.get("asOf") || "");
    params.set("period", period);
    const suffix = params.toString();
    let gone = false;
    void fetch(`/api/finance/categories?${suffix}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("categories");
        const body = (await response.json()) as Snapshot;
        if (!gone) setSnapshot(body);
      })
      .catch(() => {
        if (!gone) setMessage("Finance is unavailable.");
      });
    return () => {
      gone = true;
    };
  }, [period, search, revision]);

  useEffect(() => {
    if (!slug) {
      setCategory(null);
      return;
    }
    const week = search.get("week") || snapshot?.weekStart || "";
    if (!week) return;
    const params = new URLSearchParams();
    if (search.get("asOf")) params.set("asOf", search.get("asOf") || "");
    params.set("period", period);
    let gone = false;
    void fetch(`/api/finance/weeks/${week}/categories/${slug}?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("category");
        const body = (await response.json()) as CategoryDetail;
        if (!gone) setCategory(body);
      })
      .catch(() => {
        if (!gone) setMessage("Finance is unavailable.");
      });
    return () => {
      gone = true;
    };
  }, [slug, period, snapshot?.weekStart, search, revision]);

  useEffect(() => {
    if (!editing || !overlayOn || !slug || period !== "month") return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`budget-${slug}`)?.scrollIntoView({ block: "center", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing, overlayOn, slug, period]);

  function withPeriod(next: "month" | "week", nextSlug = slug) {
    const params = new URLSearchParams(search.toString());
    params.set("period", next);
    if (nextSlug) params.set("cat", nextSlug);
    else params.delete("cat");
    router.replace(`/finance/spending?${params.toString()}`);
  }

  const query = new URLSearchParams();
  if (search.get("asOf")) query.set("asOf", search.get("asOf") || "");
  if (search.get("week")) query.set("week", search.get("week") || "");
  query.set("period", period);
  const capsQuery = new URLSearchParams();
  if (search.get("asOf")) capsQuery.set("asOf", search.get("asOf") || "");
  if (search.get("week") || snapshot?.weekStart) capsQuery.set("week", search.get("week") || snapshot?.weekStart || "");
  const capsHref = `/finance/caps?${capsQuery.toString()}`;

  const backParams = new URLSearchParams();
  if (search.get("asOf")) backParams.set("asOf", search.get("asOf") || "");
  if (fromOverview) {
    backParams.set("week", search.get("week") || "");
  } else {
    backParams.set("period", period);
    if (search.get("week")) backParams.set("week", search.get("week") || "");
  }
  const backHref = fromOverview ? `/finance?${backParams.toString()}` : `/finance/spending?${backParams.toString()}`;
  const budgetRows = (snapshot?.categories || []).filter((item) => item.slug !== "uncategorized");

  async function saveBudgets(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const budgets: Record<string, number | null> = {};
    for (const item of budgetRows) {
      const parsed = parseBudget(fields[item.slug] ?? "");
      if (!parsed.ok) {
        setBudgetError(parsed.detail);
        setBudgetField(item.slug);
        document.getElementById(`budget-${item.slug}`)?.focus();
        return;
      }
      budgets[item.slug] = parsed.cents;
    }
    setSaving(true);
    setBudgetError("");
    try {
      const response = await fetch("/api/finance/budgets", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotency.current || (idempotency.current = crypto.randomUUID()),
        },
        body: JSON.stringify({ budgets }),
      });
      const body = (await response.json()) as { detail?: string; field?: string };
      if (!response.ok) {
        setBudgetError(body.detail || "Couldn’t save.");
        setBudgetField(body.field || "");
        if (body.field) document.getElementById(`budget-${body.field}`)?.focus();
        return;
      }
      idempotency.current = "";
      setEditing(false);
      setRevision((value) => value + 1);
    } catch {
      setBudgetError("Couldn’t save.");
    } finally {
      setSaving(false);
    }
  }
  const panelOffline = overlayOn && (overlayHold === "offline" || offline);
  const showList = !fromOverview && (!slug || wide || overlayOn);
  const showDetail = Boolean(slug) && (!overlayOn || fromOverview);
  const panelOpen = overlayOn && !fromOverview && (Boolean(slug) || (editing && period === "month"));
  const ready = showList ? Boolean(snapshot) && (!showDetail || Boolean(category)) : Boolean(category);
  const listed = snapshot?.categories.find((item) => item.slug === slug) || null;
  const selectedName = category?.name || listed?.name || "Category";
  const metaSource = category
    ? { spentCents: category.spentCents, capCents: category.capCents, estimate: category.estimate ?? listed?.estimate }
    : listed;
  const openTxn = category?.rows.find((row) => row.id === txnId) || null;

  function remember(id: string) {
    if (!overlayOn) return;
    try {
      sessionStorage.setItem("joehub.categories.return", id);
    } catch {
      // The route still opens without restoring focus.
    }
  }

  function openBudgets(defer = false) {
    if (!snapshot || period !== "month" || panelOffline) return;
    const next: Record<string, string> = {};
    for (const item of snapshot.categories) {
      if (item.slug === "uncategorized") continue;
      next[item.slug] = item.capCents == null ? "" : dollars(item.capCents);
    }
    setFields(next);
    setBudgetError("");
    setBudgetField("");
    setTxnId("");
    if (defer) window.setTimeout(() => setEditing(true), 0);
    else setEditing(true);
  }

  function closeForm() {
    setEditing(false);
    setBudgetError("");
    setBudgetField("");
  }

  function closeOverlay() {
    setTxnId("");
    setEditing(false);
    setBudgetError("");
    if (!slug) return;
    const params = new URLSearchParams();
    if (search.get("asOf")) params.set("asOf", search.get("asOf") || "");
    if (search.get("week")) params.set("week", search.get("week") || "");
    params.set("period", period);
    try {
      sessionStorage.setItem("joehub.categories.return", slug);
    } catch {
      // The list still opens.
    }
    router.push(`/finance/spending?${params.toString()}`);
  }

  const budgetForm = (
    <form id="budget-form" onSubmit={saveBudgets}>
      <p className="text-meta text-muted">Estimates come from the weekly cap. Saving them is the monthly plan.</p>
      {budgetError ? <p className="mt-3 text-body text-finance-dining">{budgetError}</p> : null}
      <div className="mt-4 space-y-3">
        {budgetRows.map((item) => (
          <label key={item.slug} className="block" htmlFor={`budget-${item.slug}`}>
            <span className="text-meta text-muted">{item.name}{item.estimate ? " · estimate" : ""}</span>
            <input
              id={`budget-${item.slug}`}
              inputMode="decimal"
              enterKeyHint="done"
              value={fields[item.slug] ?? ""}
              aria-invalid={budgetField === item.slug}
              data-autofocus={overlayOn && item.slug === slug ? "true" : undefined}
              className="mt-1 h-11 w-full rounded-xl border border-line bg-page px-3 text-base outline-none focus:border-2 focus:border-ink"
              onChange={(event) => {
                setFields((current) => ({ ...current, [item.slug]: event.target.value }));
                setBudgetField("");
              }}
            />
          </label>
        ))}
      </div>
    </form>
  );

  const overlayBody = overlayHold === "error" ? (
    <LoadError onRetry={() => setRevision((value) => value + 1)} />
  ) : overlayHold === "skel" ? (
    <div data-skeleton="category" aria-busy="true" className="px-5 py-4">
      <TextLine height={24} width={160} />
      <TextLine height={13} width={200} className="mt-3" />
      {[0, 1, 2].map((item) => (
        <div key={item} className="mt-4 flex items-center justify-between gap-3">
          <TextLine height={13} width="55%" />
          <TextLine height={13} width={64} />
        </div>
      ))}
    </div>
  ) : editing && period === "month" ? (
    <div className="px-5 py-4">{budgetForm}</div>
  ) : openTxn && category ? (
    <div className="px-5 py-4" data-txn-detail="true">
      <p className={`text-title font-medium tabular-nums ${openTxn.amountCents > 0 ? "text-finance-primary" : ""}`}>{signed(openTxn.amountCents)}</p>
      <p className="mt-1 text-meta text-muted">{openTxn.meta}</p>
      <dl className="mt-4 rounded-[20px] border border-line px-4 py-2">
        {[
          ["Category", category.name],
          ["Date", rowWhen(openTxn.meta)],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-3">
            <dt className="text-body text-muted">{label}</dt>
            <dd className="text-body font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  ) : slug ? (
    <div className="px-5 py-4" data-category-detail="true">
      {!metaSource ? <p className="text-body text-muted">{message || "Loading…"}</p> : <p data-item-meta="true" className="text-body">{budgetMeta(metaSource)}</p>}
      {category && (overlayHold === "empty" || category.rows.length === 0) ? <p className="mt-4 text-body text-muted" data-state="empty">No transactions.</p> : null}
      {category && overlayHold !== "empty" && category.rows.length > 0 ? (
        <ul className="mt-4">
          {category.rows.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => setTxnId(row.id)} className="flex min-h-11 w-full items-center gap-3 py-2.5 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium">{row.payee}</span>
                  <span className="block text-meta text-muted">{rowWhen(row.meta)}</span>
                </span>
                <span className={`shrink-0 text-body font-medium ${row.amountCents > 0 ? "text-finance-primary" : ""}`}>{signed(row.amountCents)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {panelOffline ? (
        <p role="status" data-state="offline" className="mt-4 rounded-2xl bg-table-header px-4 py-3 text-left text-body text-ink dark:bg-white/10">
          You are offline.
        </p>
      ) : null}
    </div>
  ) : null;

  const panel = (panelWide: boolean) => (
    <OverlayPanel
      wide={panelWide}
      depth={openTxn || (editing && period === "month") ? 1 : 0}
      title={editing && period === "month" ? "Monthly budgets" : openTxn ? openTxn.payee : selectedName}
      onClose={slug ? closeOverlay : closeForm}
      onBack={openTxn ? () => setTxnId("") : editing && slug ? closeForm : undefined}
      form={Boolean(editing && period === "month")}
      nested={Boolean(openTxn)}
      slim={Boolean(editing && period === "month")}
      sheet={Boolean(editing && period === "month")}
      action={editing && period === "month" ? (
        <button type="submit" form="budget-form" disabled={saving || panelOffline} className="inline-flex h-11 min-w-11 items-center justify-center bg-transparent p-0 disabled:opacity-50">
          <span className="inline-flex h-8 items-center justify-center rounded-xl bg-ink px-3.5 text-body font-medium text-page">{saving ? "Saving…" : "Save"}</span>
        </button>
      ) : period === "month" && slug && !openTxn ? (
        <button type="button" disabled={panelOffline} onClick={() => openBudgets(true)} className={`inline-flex h-11 items-center px-2 text-body font-medium ${panelOffline ? "text-muted opacity-50" : "text-ink"}`}>
          Edit
        </button>
      ) : null}
    >
      {overlayBody}
    </OverlayPanel>
  );

  return (
    <main className={`finance-type min-w-0 text-ink ${showList && wide ? "flex items-start gap-6 px-4" : ""}`} data-ready={ready ? "true" : undefined} data-period={period} data-layout={wide && !fromOverview ? "panel" : "sheet"}>
      {showList ? (
        <div className="min-w-0 flex-1">
          <header className="flex items-end justify-between gap-3 px-5 pt-2">
            <div>
              <p className="text-meta text-muted">joehub</p>
              <h1 className="text-title font-medium">Finance</h1>
            </div>
            {period === "month" ? (
              <button
                type="button"
                className="mb-1 inline-flex min-h-11 items-center text-body font-medium text-finance-primary disabled:opacity-40"
                disabled={!snapshot || panelOffline}
                onClick={() => openBudgets()}
              >
                Edit budgets
              </button>
            ) : (
              <Link href={capsHref} className="mb-1 inline-flex min-h-11 items-center text-body font-medium text-finance-primary">
                Edit caps
              </Link>
            )}
          </header>
          <div className="mt-3">
            <FinanceTabs />
          </div>
          <div data-period-track="true" className="mx-4 mt-4 grid h-11 grid-cols-2 rounded-full border border-line bg-surface p-1" role="group" aria-label="Budget period">
            {(["week", "month"] as const).map((item) => (
              <button key={item} type="button" data-period-option={item} aria-pressed={period === item} className={`rounded-full text-body font-medium ${period === item ? "bg-finance-primary text-page dark:bg-ink dark:text-page" : "text-ink"}`} onClick={() => withPeriod(item, wide || overlayOn ? slug : undefined)}>
                {item === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
          {!snapshot ? <p className="px-5 py-8 text-body text-muted">{message || "Loading…"}</p> : null}
          {snapshot ? (
            <>
              <div className="mt-5 flex items-baseline justify-between gap-3 px-5">
                <h2 className="text-section font-medium">{snapshot.label}</h2>
                {snapshot.aside ? <p className="text-meta text-muted">{snapshot.aside}</p> : null}
              </div>
              <p className="px-5 text-title font-medium">
                {money(snapshot.spentCents)} <span className="text-body font-normal text-muted">{snapshot.budgetLabel}</span>
              </p>
              <ul className="mt-2 px-4">
                {snapshot.categories.map((item) => {
                  const color = toneColor(item);
                  const itemQuery = new URLSearchParams(query);
                  const href = `/finance/spending?cat=${item.slug}&${itemQuery.toString()}`;
                  return (
                    <li key={item.slug} data-selected={item.slug === slug ? "true" : undefined} className={overlayOn && item.slug === slug ? "row-selected rounded-2xl" : item.slug === slug ? "rounded-2xl bg-surface" : ""}>
                      <Link href={href} aria-current={overlayOn && item.slug === slug ? "true" : undefined} onClick={() => remember(item.slug)} className="flex min-h-11 items-center gap-3 px-1 py-3">
                        <CategoryMark category={item.slug} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 truncate text-body font-medium">{item.name}</span>
                            <span className="shrink-0 text-body font-medium">
                              {money(item.spentCents)}
                              {item.capCents ? <span className="font-normal text-muted"> of {money(item.capCents)}{item.estimate ? " estimate" : ""}</span> : null}
                            </span>
                          </span>
                          {item.percent != null ? (
                            <span className="mt-0.5 block text-right text-meta font-medium" style={{ color }}>
                              {item.percent}% · {item.status}
                            </span>
                          ) : item.status ? (
                            <span className="mt-0.5 block text-right text-meta text-muted">{item.status}</span>
                          ) : null}
                          {item.capCents != null || item.slug !== "uncategorized" ? (
                            <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-line">
                              {item.capCents != null ? <span className="block h-full rounded-full" style={{ width: `${item.fill}%`, background: item.tone === "over" ? "#E07A5F" : item.color }} /> : null}
                            </span>
                          ) : null}
                        </span>
                        <Icon name="chevron" size={16} className="shrink-0 text-muted" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      {showDetail ? (
        <Detail category={category} message={message} wide={wide && !fromOverview} backHref={backHref} backLabel={fromOverview ? "Back to overview" : "Back"} period={period} asOf={search.get("asOf") || ""} />
      ) : null}
      {showList && wide && !slug && !editing ? (
        <aside className="card mt-4 w-[420px] shrink-0 p-5" style={{ minHeight: 520 }}>
          <p className="pt-8 text-center text-body text-muted">Select a category</p>
        </aside>
      ) : null}
      {panelOpen && wide ? panel(true) : null}
      {panelOpen && !wide ? panel(false) : null}
      {editing && period === "month" && !overlayOn ? (
        <Sheet
          title="Monthly budgets"
          dock={wide ? "panel" : "sheet"}
          formId="budget-form"
          onClose={() => setEditing(false)}
          saveDisabled={saving}
          actions={wide ? (
            <>
              <button type="button" onClick={() => setEditing(false)} className="inline-flex min-h-11 items-center px-3 text-body text-muted">Cancel</button>
              <button type="submit" form="budget-form" disabled={saving} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ink px-3 text-body font-medium text-page disabled:opacity-50">Save</button>
            </>
          ) : null}
        >
          {budgetForm}
        </Sheet>
      ) : null}
    </main>
  );
}

export function Detail({ category, message, wide, backHref, backLabel, period, asOf }: { category: CategoryDetail | null; message: string; wide: boolean; backHref: string; backLabel: string; period: "month" | "week"; asOf: string }) {
  const tone = category ? toneColor(category) : "#6B746E";
  const weekSummary =
    category && category.percent != null
      ? `${category.percent}% used · ${category.status}${category.daysLeft != null ? ` · ${category.daysLeft} days left` : ""}`
      : category?.status || "";
  return (
    <section className={wide ? "card mt-4 w-[420px] shrink-0 p-5" : "min-w-0 flex-1"} style={wide ? { minHeight: 520 } : undefined}>
      {!wide ? (
        <div className="flex items-center gap-2 px-3 pt-2">
          <Link href={backHref} aria-label={backLabel} className="grid h-11 w-11 place-items-center">
            <Icon name="back" size={20} />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-title font-medium">{category?.name || "Category"}</h1>
          {category ? <CategoryMark category={category.slug} /> : null}
        </div>
      ) : category ? (
        <div className="flex items-center gap-3">
          <CategoryMark category={category.slug} />
          <h2 className="text-title font-medium">{category.name}</h2>
        </div>
      ) : null}
      {!category ? <p className="px-5 py-8 text-body text-muted">{message || "Loading…"}</p> : null}
      {category && period === "week" ? (
        <>
          <div className={wide ? "mt-4" : "px-5"}>
            <p className="text-title font-medium">
              {money(category.spentCents)} <span className="text-body font-normal text-muted">of {money(category.capCents || 0)} this week</span>
            </p>
            <p className="mt-1 text-body font-medium" style={{ color: tone }}>
              {weekSummary}
            </p>
          </div>
          {category.percent != null ? (
            <div className={`${wide ? "mt-3" : "mx-4 mt-3"} rounded-[20px] border border-line p-4`}>
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full" style={{ width: `${category.fill}%`, background: category.tone === "over" ? "#E07A5F" : category.color }} />
              </div>
            </div>
          ) : null}
          <div className={`mt-5 flex items-baseline justify-between ${wide ? "" : "px-5"}`}>
            <h2 className="text-section font-medium">This week’s transactions</h2>
            <p className="text-meta text-muted">
              {category.rows.length} · sum {money(category.spentCents)}
            </p>
          </div>
        </>
      ) : null}
      {category && period === "month" ? (
        <>
          <p className={`text-meta text-muted ${wide ? "mt-4" : "px-5"}`}>{category.label}</p>
          <p className={`text-title font-medium ${wide ? "" : "px-5"}`}>
            {money(category.spentCents)} {category.capCents ? <span className="text-body font-normal text-muted">of {money(category.capCents)}</span> : null}
          </p>
          {category.percent != null ? (
            <p className={`text-body font-medium ${wide ? "" : "px-5"}`} style={{ color: tone }}>
              {category.percent}% · {category.status}
            </p>
          ) : (
            <p className={`text-body text-muted ${wide ? "" : "px-5"}`}>{category.status}</p>
          )}
          {category.capCents ? (
            <div className={`${wide ? "mt-3" : "mx-5 mt-3"} h-1.5 overflow-hidden rounded-full bg-line`}>
              <div className="h-full rounded-full" style={{ width: `${category.fill}%`, background: category.tone === "over" ? "#E07A5F" : category.color }} />
            </div>
          ) : null}
          <h2 className={`mt-5 text-section font-medium ${wide ? "" : "px-5"}`}>{category.label}</h2>
        </>
      ) : null}
      {category ? (
        <ul className={wide ? "" : "px-5"}>
          {category.rows.map((row) => {
            const href = `/finance/transactions?week=${row.week}&edit=${row.id}${asOf ? `&asOf=${encodeURIComponent(asOf)}` : ""}`;
            return (
              <li key={row.id}>
                <Link href={href} className="flex min-h-11 items-center gap-3 border-b border-line py-2.5">
                  <CategoryMark category={category.slug} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium">{row.payee}</span>
                    <span className="block text-meta text-muted">{row.meta}</span>
                  </span>
                  <span className={`shrink-0 text-body font-medium ${row.amountCents > 0 ? "text-finance-primary" : ""}`}>{signed(row.amountCents)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
