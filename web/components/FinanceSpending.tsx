"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { countsAsSpend, hiddenBucketsLabel, money, removeBucketDetail, spendCents } from "../lib/finance.mjs";
import { showMonthBudget } from "../lib/live-pages.mjs";
import { categoryBar } from "../lib/spending-bars.mjs";
import { readOverlayHold } from "../lib/overlay-motion.mjs";
import { readSkeletonHold } from "../lib/skeleton-gate.mjs";
import { CategoryMark } from "./CategoryMark";
import { Detail as CategoryDrill, type CategoryDetail } from "./FinanceCategory";
import { FinanceTabs } from "./FinanceTabs";
import { Icon } from "./Icon";
import { useOverlayHolds, useOverlays, useProductionNav, useSkeletonHolds, useSkeletons } from "./LivePages";
import { ConfirmDialog, OverlayPanel } from "./OverlayPanel";
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
  capCents?: number | null;
  estimate?: boolean;
  percent?: number | null;
  status?: string;
};

type Snapshot = {
  label: string;
  spentCents: number;
  weekStart?: string;
  budgetLabel?: string;
  categories: CategoryRow[];
};

type Bucket = {
  slug: string;
  name: string;
  color?: string;
  hidden: boolean;
  spentCents?: number;
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

function budgetMeta(item: { spentCents: number; capCents?: number | null; estimate?: boolean }) {
  const spent = money(item.spentCents);
  if (!item.capCents) return spent;
  return `${spent} of ${money(item.capCents)}${item.estimate ? " estimate" : ""}`;
}

function rowWhen(meta: string) {
  return meta.split(" · ")[0]?.trim() || "";
}

function signed(cents: number) {
  const text = money(Math.abs(cents), true);
  if (cents > 0) return `+${text}`;
  if (cents < 0) return `−${text}`;
  return text;
}

function categoryUrl(slug: string) {
  return "/api/finance/categories/" + encodeURIComponent(slug);
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
  const cat = search.get("cat") || "";
  const explicitPeriod = search.get("period");
  const weekParam = search.get("week") || "";
  const period = explicitPeriod === "week" || explicitPeriod === "month" ? explicitPeriod : cat && weekParam ? "week" : "month";
  const fromOverview = Boolean(cat) && explicitPeriod == null && Boolean(weekParam);
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
  const [drill, setDrill] = useState<CategoryDetail | null>(null);
  const [drillMessage, setDrillMessage] = useState("");
  const [drillTick, setDrillTick] = useState(0);
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [budgetError, setBudgetError] = useState("");
  const [budgetField, setBudgetField] = useState("");
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [panelTxn, setPanelTxn] = useState("");
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [bucketsOpen, setBucketsOpen] = useState(false);
  const [bucketMode, setBucketMode] = useState<"list" | "add" | "rename">("list");
  const [bucketSlug, setBucketSlug] = useState("");
  const [bucketName, setBucketName] = useState("");
  const [bucketError, setBucketError] = useState("");
  const [bucketSaving, setBucketSaving] = useState(false);
  const [removeSlug, setRemoveSlug] = useState("");
  const idempotency = useRef("");
  const bucketIdem = useRef("");
  const confirmRef = useRef<HTMLDivElement>(null);
  const pending = !snapshot && !failed && hold !== "refresh" && hold !== "empty" && hold !== "error" && hold !== "skel";
  const { phase, refreshing } = useSkeletonPhase(skeletonOn, hold, pending, Boolean(snapshot) || hold === "refresh" || hold === "empty");
  const bones = skeletonOn && (hold === "skel" || (phase === "skeleton" && !snapshot));
  const offline = tone === "offline";
  const panelOffline = overlayHold === "offline" || offline;
  const showError = !offline && ((skeletonOn && hold === "error") || (failed && !snapshot));
  const showEmptyHold = skeletonOn && hold === "empty";

  const load = useCallback(async () => {
    const bucketQuery = new URLSearchParams();
    if (asOf) bucketQuery.set("asOf", asOf);
    const bucketResponse = await fetch(`/api/finance/buckets${bucketQuery.size ? `?${bucketQuery.toString()}` : ""}`, { cache: "no-store" });
    if (!bucketResponse.ok) throw new Error("buckets");
    const bucketBody = (await bucketResponse.json()) as { buckets?: Bucket[] };
    const list = Array.isArray(bucketBody.buckets) ? bucketBody.buckets : [];
    const hidden = new Set(list.filter((item) => item.hidden).map((item) => item.slug));
    setBuckets(list);
    const visibleTxn = (row: Txn) => !row.category || !hidden.has(row.category);
    if (period !== "week") {
      const params = new URLSearchParams();
      if (asOf) params.set("asOf", asOf);
      const response = await fetch(`/api/finance/spending/month${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("month");
      const body = (await response.json()) as Snapshot & { month?: Month | null; transactions?: Txn[] };
      setSnapshot({
        label: body.label,
        spentCents: body.spentCents,
        weekStart: body.weekStart,
        budgetLabel: body.budgetLabel,
        categories: body.categories,
      });
      setMonth(body.month ?? null);
      setTxns((Array.isArray(body.transactions) ? body.transactions : []).filter(visibleTxn));
      setFailed(false);
      return;
    }
    const params = new URLSearchParams();
    if (asOf) params.set("asOf", asOf);
    params.set("period", "week");
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
    setTxns(collected.filter(visibleTxn));
    setFailed(false);
  }, [asOf, period]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const apply = () => setWide(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!removeSlug) return;
    const node = confirmRef.current;
    const buttons = () => [...(node?.querySelectorAll<HTMLElement>("button") ?? [])].filter((el) => !el.hasAttribute("disabled"));
    buttons().find((el) => el.textContent?.trim() === "Cancel")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!bucketSaving) {
          setRemoveSlug("");
          setBucketError("");
        }
        return;
      }
      if (event.key !== "Tab") return;
      const items = buttons();
      if (!items.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : index < 0 || index === items.length - 1 ? 0 : index + 1;
      items[next]?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [removeSlug, bucketSaving]);

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
    if (fromOverview) return;
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
  }, [load, revision, skeletonOn, hold, fromOverview]);

  function retry() {
    setFailed(false);
    setRevision((value) => value + 1);
  }

  useEffect(() => {
    setPanelTxn("");
    setBudgetsOpen(false);
    setBudgetError("");
  }, [cat]);

  useEffect(() => {
    if (!cat || selectedId || budgetsOpen || panelTxn) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const next = new URLSearchParams(window.location.search);
      next.delete("cat");
      const query = next.toString();
      router.replace(query ? `/finance/spending?${query}` : "/finance/spending", { scroll: false });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cat, selectedId, budgetsOpen, panelTxn, router]);

  useEffect(() => {
    if (!cat) {
      setDrill(null);
      return;
    }
    const weekId = weekParam || snapshot?.weekStart || "";
    if (!weekId) return;
    const params = new URLSearchParams();
    if (asOf) params.set("asOf", asOf);
    params.set("period", fromOverview || period === "week" ? "week" : "month");
    let gone = false;
    void fetch(`/api/finance/weeks/${weekId}/categories/${encodeURIComponent(cat)}?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("category");
        const body = (await response.json()) as CategoryDetail;
        if (!gone) {
          setDrill(body);
          setDrillMessage("");
        }
      })
      .catch(() => {
        if (!gone) setDrillMessage("Finance is unavailable.");
      });
    return () => {
      gone = true;
    };
  }, [cat, period, fromOverview, asOf, weekParam, snapshot?.weekStart, drillTick]);

  useEffect(() => {
    if (!budgetsOpen || !overlayOn || !cat || period !== "month") return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`budget-${cat}`)?.scrollIntoView({ block: "center", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [budgetsOpen, overlayOn, cat, period]);

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

  const budgetRows = (snapshot?.categories || []).filter((item) => item.slug !== "uncategorized");
  const listedCat = snapshot?.categories.find((item) => item.slug === cat) || null;
  const metaSource = drill
    ? { spentCents: drill.spentCents, capCents: drill.capCents, estimate: drill.estimate ?? listedCat?.estimate }
    : listedCat;
  const openPanelTxn = drill?.rows.find((row) => row.id === panelTxn) || null;
  const categoryTitle = drill?.name || listedCat?.name || "Category";

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
    setPanelTxn("");
    if (selectedId) go((nextParams) => nextParams.delete("txn"));
    if (defer) window.setTimeout(() => setBudgetsOpen(true), 0);
    else setBudgetsOpen(true);
  }

  function closeBudgets() {
    setBudgetsOpen(false);
    setBudgetError("");
    setBudgetField("");
  }

  function openBuckets() {
    if (!snapshot || panelOffline) return;
    setBucketMode("list");
    setBucketError("");
    setBucketName("");
    setBudgetsOpen(false);
    setPanelTxn("");
    if (selectedId || cat) {
      go((next) => {
        next.delete("txn");
        next.delete("cat");
      });
    }
    setBucketsOpen(true);
  }

  function closeBuckets() {
    if (removeSlug) return;
    setBucketsOpen(false);
    setBucketMode("list");
    setBucketError("");
    setBucketName("");
  }

  function closeRemove() {
    if (bucketSaving) return;
    setRemoveSlug("");
    setBucketError("");
  }

  async function setHidden(slug: string, hidden: boolean) {
    setBucketError("");
    try {
      const response = await fetch(categoryUrl(slug), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hidden }),
      });
      const body = (await response.json().catch(() => ({}))) as { detail?: string };
      if (!response.ok) {
        setBucketError(body.detail || "Couldn’t save.");
        return;
      }
      await load();
    } catch {
      setBucketError("Couldn’t save.");
    }
  }

  async function saveBucket(event: FormEvent) {
    event.preventDefault();
    const name = bucketName.trim().replace(/\s+/g, " ");
    if (!name) {
      setBucketError("Enter a name.");
      return;
    }
    setBucketSaving(true);
    setBucketError("");
    const creating = bucketMode === "add";
    try {
      const response = await fetch(creating ? "/api/finance/categories" : categoryUrl(bucketSlug), {
        method: creating ? "POST" : "PATCH",
        headers: {
          "content-type": "application/json",
          ...(creating ? { "idempotency-key": bucketIdem.current || (bucketIdem.current = crypto.randomUUID()) } : {}),
        },
        body: JSON.stringify({ name }),
      });
      const body = (await response.json().catch(() => ({}))) as { detail?: string };
      if (!response.ok) {
        setBucketError(body.detail || "Couldn’t save.");
        return;
      }
      bucketIdem.current = "";
      setBucketMode("list");
      setBucketName("");
      await load();
    } catch {
      setBucketError("Couldn’t save.");
    } finally {
      setBucketSaving(false);
    }
  }

  async function confirmRemove() {
    if (!removeSlug || bucketSaving) return;
    setBucketSaving(true);
    setBucketError("");
    try {
      const response = await fetch(categoryUrl(removeSlug), { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as { detail?: string };
      if (!response.ok) {
        setBucketError(body.detail || "Couldn’t remove.");
        return;
      }
      setRemoveSlug("");
      await load();
    } catch {
      setBucketError("Couldn’t remove.");
    } finally {
      setBucketSaving(false);
    }
  }

  async function saveBudgets(event: FormEvent) {
    event.preventDefault();
    if (budgetSaving) return;
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
    setBudgetSaving(true);
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
      setBudgetsOpen(false);
      await load();
      setDrillTick((value) => value + 1);
    } catch {
      setBudgetError("Couldn’t save.");
    } finally {
      setBudgetSaving(false);
    }
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
              data-autofocus={overlayOn && item.slug === cat ? "true" : undefined}
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

  const categoryBody = budgetsOpen && period === "month" ? (
    <div className="px-5 py-4">{budgetForm}</div>
  ) : openPanelTxn && drill ? (
    <div className="px-5 py-4" data-txn-detail="true">
      <p className={`text-title font-medium tabular-nums ${openPanelTxn.amountCents > 0 ? "text-finance-primary" : ""}`}>{signed(openPanelTxn.amountCents)}</p>
      <p className="mt-1 text-meta text-muted">{openPanelTxn.meta}</p>
      <dl className="mt-4 rounded-[20px] border border-line px-4 py-2">
        {[
          ["Category", drill.name],
          ["Date", rowWhen(openPanelTxn.meta)],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-3">
            <dt className="text-body text-muted">{label}</dt>
            <dd className="text-body font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  ) : cat ? (
    <div className="px-5 py-4" data-category-detail="true">
      {!metaSource ? <p className="text-body text-muted">{drillMessage || "Loading…"}</p> : <p data-item-meta="true" className="text-body">{budgetMeta(metaSource)}</p>}
      {drill && drill.rows.length === 0 ? <p className="mt-4 text-body text-muted" data-state="empty">No transactions.</p> : null}
      {drill && drill.rows.length > 0 ? (
        <ul className="mt-4">
          {drill.rows.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => setPanelTxn(row.id)} className="flex min-h-11 w-full items-center gap-3 py-2.5 text-left">
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

  const categoryPanel = (panelWide: boolean) => (
    <OverlayPanel
      wide={panelWide}
      depth={openPanelTxn || budgetsOpen ? 1 : 0}
      title={budgetsOpen ? "Monthly budgets" : openPanelTxn ? openPanelTxn.payee : categoryTitle}
      onClose={() => {
        setPanelTxn("");
        closeBudgets();
        if (cat) go((next) => next.delete("cat"));
      }}
      onBack={openPanelTxn ? () => setPanelTxn("") : budgetsOpen && cat ? closeBudgets : undefined}
      form={budgetsOpen}
      nested={Boolean(openPanelTxn)}
      slim={budgetsOpen}
      sheet={budgetsOpen}
      action={budgetsOpen ? (
        <button type="submit" form="budget-form" disabled={budgetSaving || panelOffline} className="inline-flex h-11 min-w-11 items-center justify-center bg-transparent p-0 disabled:opacity-50">
          <span className="inline-flex h-8 items-center justify-center rounded-xl bg-ink px-3.5 text-body font-medium text-page">{budgetSaving ? "Saving…" : "Save"}</span>
        </button>
      ) : period === "month" && cat && !openPanelTxn ? (
        <button type="button" disabled={panelOffline} onClick={() => openBudgets(true)} className={`inline-flex h-11 items-center px-2 text-body font-medium ${panelOffline ? "text-muted opacity-50" : "text-ink"}`}>
          Edit
        </button>
      ) : null}
    >
      {categoryBody}
    </OverlayPanel>
  );

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

  const removeTarget = buckets.find((item) => item.slug === removeSlug) || null;
  const hiddenLabel = hiddenBucketsLabel(buckets.filter((item) => item.hidden).length);
  const bucketTitle = bucketMode === "add" ? "Add bucket" : bucketMode === "rename" ? "Rename" : "Buckets";
  const bucketPanel = (panelWide: boolean) => (
    <OverlayPanel
      wide={panelWide}
      title={bucketTitle}
      onClose={closeBuckets}
      onBack={bucketMode === "list" ? undefined : () => { setBucketMode("list"); setBucketError(""); }}
      form={bucketMode !== "list"}
      slim={bucketMode !== "list"}
      sheet={bucketMode !== "list"}
      confirming={Boolean(removeSlug)}
      action={
        bucketMode === "list" ? (
          <button type="button" onClick={() => { setBucketMode("add"); setBucketName(""); setBucketError(""); }} className="inline-flex h-11 items-center px-2 text-body font-medium text-finance-primary">
            Add
          </button>
        ) : (
          <button type="submit" form="bucket-form" disabled={bucketSaving || panelOffline || !bucketName.trim()} className="inline-flex h-11 min-w-11 items-center justify-center bg-transparent p-0 disabled:opacity-50">
            <span className="inline-flex h-8 items-center justify-center rounded-xl bg-ink px-3.5 text-body font-medium text-page">{bucketSaving ? "Saving…" : "Save"}</span>
          </button>
        )
      }
    >
      <div className="min-w-0 px-5 py-4" data-buckets={bucketMode}>
        {bucketError ? <p role="alert" className="mb-3 text-body text-finance-dining">{bucketError}</p> : null}
        {bucketMode === "list" ? (
          <ul>
            {buckets.map((item) => (
              <li key={item.slug} data-bucket={item.slug} data-hidden={item.hidden ? "true" : "false"} className="border-b border-line py-2">
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-body font-medium">{item.name}</span>
                  {item.hidden ? <span className="shrink-0 text-meta text-muted">Hidden</span> : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  <button type="button" data-bucket-action="hide" className="inline-flex h-11 min-w-11 items-center px-2 text-body text-ink" onClick={() => void setHidden(item.slug, !item.hidden)}>
                    {item.hidden ? "Show" : "Hide"}
                  </button>
                  <button type="button" data-bucket-action="rename" className="inline-flex h-11 min-w-11 items-center px-2 text-body text-ink" onClick={() => { setBucketSlug(item.slug); setBucketName(item.name); setBucketError(""); setBucketMode("rename"); }}>
                    Rename
                  </button>
                  <button type="button" data-bucket-action="remove" className="inline-flex h-11 min-w-11 items-center px-2 text-body text-ink" onClick={() => { setRemoveSlug(item.slug); setBucketError(""); }}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <form id="bucket-form" onSubmit={saveBucket}>
            <label className="block" htmlFor="bucket-name">
              <span className="text-meta text-muted">Name</span>
              <input
                id="bucket-name"
                value={bucketName}
                inputMode="text"
                enterKeyHint="done"
                autoComplete="off"
                autoCapitalize="words"
                data-autofocus="true"
                className="mt-1 h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base outline-none focus:border-2 focus:border-ink"
                onChange={(event) => {
                  setBucketName(event.target.value);
                  setBucketError("");
                }}
              />
            </label>
          </form>
        )}
        {panelOffline ? (
          <p role="status" data-state="offline" className="mt-4 rounded-2xl bg-table-header px-4 py-3 text-left text-body text-ink dark:bg-white/10">
            You are offline.
          </p>
        ) : null}
      </div>
    </OverlayPanel>
  );

  const capsQuery = new URLSearchParams();
  if (asOf) capsQuery.set("asOf", asOf);
  if (weekParam || snapshot?.weekStart) capsQuery.set("week", weekParam || snapshot?.weekStart || "");
  const capsHref = `/finance/caps?${capsQuery.toString()}`;
  const overviewBack = (() => {
    const back = new URLSearchParams();
    if (asOf) back.set("asOf", asOf);
    if (weekParam) back.set("week", weekParam);
    return `/finance?${back.toString()}`;
  })();
  const breakdown = period === "week" ? budgetRows : rows;

  if (fromOverview) {
    return (
      <main className="finance-type min-w-0 text-ink" data-ready={drill ? "true" : undefined}>
        <CategoryDrill category={drill} message={drillMessage} wide={false} backHref={overviewBack} backLabel="Back to overview" period="week" asOf={asOf} />
      </main>
    );
  }

  return (
    <main className="finance-type min-w-0 text-ink" data-ready={snapshot && !bones ? "true" : undefined} data-spending={rows.length ? "list" : snapshot ? "empty" : "loading"} data-plan={planOn ? (month?.saved ? "plan" : "estimate") : "none"} data-layout={wide ? "panel" : "sheet"} data-period={period}>
      <header className="flex items-end justify-between gap-3 px-5 pt-2">
        <div className="min-w-0">
          <p className="text-meta text-muted">joehub</p>
          <h1 className="text-title font-medium">Finance</h1>
        </div>
        {period === "month" ? (
          <button type="button" className="mb-1 inline-flex min-h-11 shrink-0 items-center text-body font-medium text-finance-primary disabled:opacity-40" disabled={!snapshot || panelOffline} onClick={() => openBudgets()}>
            Edit budgets
          </button>
        ) : (
          <Link href={capsHref} className="mb-1 inline-flex min-h-11 shrink-0 items-center text-body font-medium text-finance-primary">
            Edit caps
          </Link>
        )}
      </header>
      <div className="mt-3">
        <FinanceTabs />
      </div>
      <div className="px-5">
        <button type="button" data-open-buckets="true" aria-label="Manage buckets" className="flex min-h-11 w-full items-center justify-between gap-3 text-body text-ink disabled:opacity-40" disabled={!snapshot || panelOffline} onClick={openBuckets}>
          <span className="font-medium">Buckets</span>
          <span className="inline-flex items-center gap-1 font-medium text-finance-primary">
            Manage
            <Icon name="chevron" size={16} className="shrink-0" />
          </span>
        </button>
      </div>
      <div data-period-track="true" className="mx-4 mt-1 grid h-11 grid-cols-2 rounded-full border border-line bg-surface p-1" role="group" aria-label="Budget period">
        {(["week", "month"] as const).map((item) => (
          <button key={item} type="button" data-period-option={item} aria-pressed={period === item} className={`rounded-full text-body font-medium ${period === item ? "bg-finance-primary text-page dark:bg-ink dark:text-page" : "text-ink"}`} onClick={() => go((next) => next.set("period", item))}>
            {item === "week" ? "Week" : "Month"}
          </button>
        ))}
      </div>
      <div className={wide && overlayOn && (selectedId || cat || budgetsOpen || bucketsOpen) ? "flex min-w-0 items-start" : "min-w-0"}>
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
              {period === "month" ? (
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
                  {hiddenLabel ? (
                    <button type="button" data-hidden-buckets={buckets.filter((item) => item.hidden).length} className="mt-1 inline-flex min-h-11 items-center text-meta text-muted" onClick={openBuckets}>
                      {hiddenLabel}
                    </button>
                  ) : null}
                </section>
              ) : (
                <div className="mt-5 px-5">
                  <h2 className="text-section font-medium">{snapshot?.label}</h2>
                  <p className="text-title font-medium">
                    {money(spent)} {snapshot?.budgetLabel ? <span className="text-body font-normal text-muted">{snapshot.budgetLabel}</span> : null}
                  </p>
                </div>
              )}
              {breakdown.length ? (
                <ul className="mt-4 px-4">
                  {breakdown.map((item) => {
                    const bar = categoryBar(item, spent);
                    return (
                      <li key={item.slug} data-selected={item.slug === cat ? "true" : undefined} className={item.slug === cat ? "row-selected rounded-2xl" : ""}>
                        <Link href={hrefFor(search, (next) => { next.set("cat", item.slug); next.set("period", period); next.delete("txn"); })} className="flex min-h-11 items-center gap-3 px-1 py-3">
                          <CategoryMark category={item.slug} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-3">
                              <span className="min-w-0 truncate text-body font-medium">{item.name}</span>
                              <span className="shrink-0 text-right text-body font-medium">
                                {money(item.spentCents)}
                                {item.capCents ? <span className="font-normal text-muted"> of {money(item.capCents)}{item.estimate ? " estimate" : ""}</span> : null}
                              </span>
                            </span>
                            {item.percent != null ? (
                              <span className={`mt-0.5 block text-right text-meta ${bar.over ? "" : "text-muted"}`} data-row-meta={bar.over ? "over" : "under"} style={bar.over ? { color: "var(--chart-negative)" } : undefined}>
                                {item.percent}% · {item.status}
                              </span>
                            ) : item.status ? (
                              <span className="mt-0.5 block text-right text-meta text-muted">{item.status}</span>
                            ) : null}
                            <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-line">
                              <span data-bar={bar.mode} data-over={bar.over ? "true" : "false"} className="block h-full rounded-full" style={{ width: `${bar.width}%`, background: bar.color }} />
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
              {period === "month" && rows.length ? (
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
        {overlayOn && wide && !selectedId && bucketsOpen ? bucketPanel(true) : null}
        {overlayOn && wide && !selectedId && !bucketsOpen && (cat || budgetsOpen) ? categoryPanel(true) : null}
      </div>
      {overlayOn && !wide && selectedId ? panel(false) : null}
      {overlayOn && !wide && !selectedId && bucketsOpen ? bucketPanel(false) : null}
      {overlayOn && !wide && !selectedId && !bucketsOpen && (cat || budgetsOpen) ? categoryPanel(false) : null}
      {removeSlug ? (
        <div ref={confirmRef} data-remove-dialog="true">
          <ConfirmDialog
            title="Remove"
            detail={removeBucketDetail(removeTarget?.name || "This bucket", removeTarget?.spentCents || 0)}
            error={bucketError}
            confirmLabel={bucketSaving ? "Removing…" : "Remove"}
            confirmDisabled={bucketSaving || panelOffline}
            confirmClassName="order-2 inline-flex h-11 min-w-11 flex-1 items-center justify-center rounded-xl bg-warn text-body font-medium text-on-warn disabled:opacity-50"
            onCancel={closeRemove}
            onConfirm={() => void confirmRemove()}
          />
        </div>
      ) : null}
    </main>
  );
}
