"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { focusReturnSelector, readOverlayHold } from "../lib/overlay-motion.mjs";
import { useOverlayHolds, useOverlays } from "./LivePages";
import { FinanceTabs } from "./FinanceTabs";
import { Icon } from "./Icon";
import { OverlayPanel } from "./OverlayPanel";
import { Sheet } from "./Sheet";
import { goalMonthlyCents, money } from "../lib/finance.mjs";

type Goal = {
  slug: string;
  name: string;
  value: number;
  amount: string;
  target: string;
  note: string;
  savedCents?: number;
  targetCents?: number;
  monthlyCents?: number | null;
  kind?: string;
  account?: string;
  color?: string;
};

const FALLBACK = ["#2E8B6A", "#3A86C8", "#E9B949", "#8E7CC3"];

function ring(value: number, radius: number) {
  const length = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  return `${(clamped / 100) * length} ${length}`;
}

function Ring({ value, color, size, stroke, label }: { value: number; color: string; size: number; stroke: number; label: string }) {
  const shown = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
  const radius = size / 2 - stroke;
  const center = size / 2;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={label}>
        <circle cx={center} cy={center} r={radius} stroke="var(--line)" strokeWidth={stroke} fill="none" />
        <circle cx={center} cy={center} r={radius} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={ring(shown, radius)} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-meta font-medium text-ink">{shown}%</span>
    </div>
  );
}

function centsFromInput(value: string) {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  if (frac.length > 2) return null;
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

function Detail({ goal, boxed, titled, panel, showPercent, showTarget }: { goal: Goal; boxed?: boolean; titled?: boolean; panel?: boolean; showPercent?: boolean; showTarget?: boolean }) {
  const color = goal.color || FALLBACK[0];
  const shown = Number.isFinite(goal.value) ? Math.max(0, Math.min(100, Math.round(goal.value))) : 0;
  const percent = showPercent ?? !titled;
  const target = showTarget ?? Boolean(boxed);
  const rows = [
    goal.kind ? ["Type", goal.kind] : null,
    target ? ["Target", goal.target] : null,
    goal.account ? ["In account", goal.account] : null,
    Number.isInteger(goal.monthlyCents) ? ["Monthly", money(goal.monthlyCents as number)] : null,
  ].filter((row): row is string[] => Array.isArray(row));
  return (
    <div className={titled ? "flex w-full flex-col items-center" : ""}>
      <div className={`flex flex-col items-center ${boxed ? "px-5" : ""}`}>
        <Ring value={shown} color={color} size={140} stroke={12} label={`${goal.name} ${shown} percent`} />
        {titled ? <h2 className="mt-4 text-section font-medium text-ink">{goal.name}</h2> : null}
        <p className={`${titled ? "mt-2" : "mt-4"} text-title font-medium tabular-nums text-ink`}>{goal.amount}</p>
        <p className="mt-1 text-body text-muted">of {goal.target}</p>
        {percent ? (
          <p className="mt-2 text-body font-medium" style={{ color }}>
            {shown}%
          </p>
        ) : null}
      </div>
      <dl className={`divide-y divide-line text-body ${boxed || panel ? "card mt-6" : "mt-5 w-full"} ${boxed ? "mx-5" : ""}`}>
        {rows.map(([label, value]) => (
          <div key={label} className={`flex min-h-11 items-center justify-between gap-4 py-3 ${boxed || panel ? "px-4" : ""}`}>
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-medium tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function FinanceGoals({ goals, slug, failed }: { goals: Goal[] | null; slug?: string; failed?: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const overlayOn = useOverlays();
  const overlayHold = readOverlayHold(search, useOverlayHolds());
  const [wide, setWide] = useState(false);
  const [tone, setTone] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [field, setField] = useState("");
  const formKey = useId();
  const [draft, setDraft] = useState({ name: "", kind: "Savings", saved: "", target: "", note: "", account: "", monthly: "" });
  const panelOffline = overlayHold === "offline" || tone === "offline";

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
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    if (typeof navigator !== "undefined" && navigator.onLine === false) setTone("offline");
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    if (!overlayOn) return;
    if (slug) return;
    const back = sessionStorage.getItem("joehub.goals.return");
    if (!back) return;
    const selector = focusReturnSelector(back);
    const link = selector ? document.querySelector(selector) : null;
    if (link instanceof HTMLElement) link.focus();
    sessionStorage.removeItem("joehub.goals.return");
  }, [overlayOn, slug]);

  const rows = Array.isArray(goals) ? goals : [];
  const selected = rows.find((goal) => goal.slug === slug) || null;
  const monthly = goalMonthlyCents(rows);
  const detailOnly = !overlayOn && !wide && Boolean(slug);
  const empty = !failed && rows.length === 0;

  function closeOverlay() {
    if (slug) sessionStorage.setItem("joehub.goals.return", slug);
    router.push("/finance/goals");
  }

  function openAdd() {
    setError("");
    setField("");
    setDraft({ name: "", kind: "Savings", saved: "", target: "", note: "", account: "", monthly: "" });
    setAdding(true);
  }

  function editDraft(partial: Partial<typeof draft>) {
    setDraft({ ...draft, ...partial });
    setError("");
    setField("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || (overlayOn && panelOffline)) return;
    const savedCents = centsFromInput(draft.saved);
    const targetCents = centsFromInput(draft.target);
    const monthlyCents = draft.monthly.trim() === "" ? null : centsFromInput(draft.monthly);
    if (savedCents == null) {
      setField("saved");
      setError("Enter an amount.");
      return;
    }
    if (targetCents == null || targetCents <= 0) {
      setField("target");
      setError("Enter a target.");
      return;
    }
    if (draft.monthly.trim() !== "" && monthlyCents == null) {
      setField("monthly");
      setError("Enter a monthly amount.");
      return;
    }
    setSaving(true);
    setError("");
    const response = await fetch("/api/finance/goals", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        name: draft.name,
        kind: draft.kind,
        savedCents,
        targetCents,
        monthlyCents,
        note: draft.note,
        account: draft.account,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setField(String(body.field || ""));
      setError(String(body.detail || "Could not save."));
      return;
    }
    setAdding(false);
    router.refresh();
  }

  const fieldClass = "mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-3 text-base outline-none focus:border-2 focus:border-ink";

  const goalForm = (
    <form id="goal-add" key={formKey} onSubmit={save} className="space-y-4">
      <div>
        <label className="block text-meta font-medium" htmlFor="goal-name">Name</label>
        <input id="goal-name" data-autofocus="true" value={draft.name} onChange={(event) => editDraft({ name: event.target.value })} enterKeyHint="next" autoComplete="off" className={fieldClass} />
      </div>
      <div>
        <label className="block text-meta font-medium" htmlFor="goal-kind">Type</label>
        <select id="goal-kind" value={draft.kind} onChange={(event) => editDraft({ kind: event.target.value })} className={fieldClass}>
          <option>Savings</option>
          <option>Debt</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-meta font-medium" htmlFor="goal-saved">Saved</label>
          <input id="goal-saved" inputMode="decimal" enterKeyHint="next" value={draft.saved} onChange={(event) => editDraft({ saved: event.target.value })} autoComplete="off" className={fieldClass} />
        </div>
        <div>
          <label className="block text-meta font-medium" htmlFor="goal-target">Target</label>
          <input id="goal-target" inputMode="decimal" enterKeyHint="next" value={draft.target} onChange={(event) => editDraft({ target: event.target.value })} autoComplete="off" className={fieldClass} />
        </div>
      </div>
      <div>
        <label className="block text-meta font-medium" htmlFor="goal-note">Note</label>
        <input id="goal-note" value={draft.note} onChange={(event) => editDraft({ note: event.target.value })} enterKeyHint="next" autoComplete="off" className={fieldClass} />
      </div>
      <div>
        <label className="block text-meta font-medium" htmlFor="goal-account">In account</label>
        <input id="goal-account" value={draft.account} onChange={(event) => editDraft({ account: event.target.value })} enterKeyHint="next" autoComplete="off" className={fieldClass} />
      </div>
      <div>
        <label className="block text-meta font-medium" htmlFor="goal-monthly">Monthly</label>
        <input id="goal-monthly" inputMode="decimal" enterKeyHint="done" value={draft.monthly} onChange={(event) => editDraft({ monthly: event.target.value })} autoComplete="off" className={fieldClass} />
      </div>
      {error ? (
        <p role="alert" className="text-meta font-medium text-warn" data-field={field}>
          {error}
        </p>
      ) : null}
    </form>
  );

  const offlineBanner = (placed: "list" | "panel") =>
    overlayOn && panelOffline ? (
      <p role="status" data-state="offline" className={`${placed === "list" ? `mb-3 ${wide ? "" : "mx-5"}` : "mt-4"} rounded-2xl bg-table-header px-4 py-3 text-left text-body text-ink dark:bg-white/10`}>
        You are offline.
      </p>
    ) : null;

  const list = failed ? (
    <p className="px-5 pt-16 text-center text-body">Goals didn’t load.</p>
  ) : empty ? (
    <div>
      {offlineBanner("list")}
      <div className="mt-16 flex flex-col items-center px-5 text-center" data-empty="true">
        <h2 className="text-section font-medium text-ink">No goals yet</h2>
        <button type="button" className="mt-5 inline-flex min-h-11 min-w-[180px] items-center justify-center rounded-xl bg-ink px-4 text-body font-medium text-page" onClick={openAdd}>
          Add a goal
        </button>
      </div>
    </div>
  ) : (
    <div>
      {offlineBanner("list")}
      {monthly != null ? <p className={wide ? "text-meta text-muted" : "px-5 text-meta text-muted"}>{money(monthly)} / mo</p> : null}
      <ul className={`space-y-2.5 ${wide ? "mt-2" : "mt-2.5 px-5"}`}>
        {rows.map((goal, index) => {
          const current = goal.slug === slug;
          return (
            <li key={goal.slug}>
              <Link
                href={`/finance/goals/${goal.slug}`}
                data-goal={goal.slug}
                aria-current={current ? "page" : undefined}
                className={`card flex min-h-11 items-center gap-4 p-4 text-left text-ink hover:text-ink focus:text-ink ${overlayOn && current ? "row-selected" : ""}`}
              >
                <Ring value={goal.value} color={goal.color || FALLBACK[index % FALLBACK.length]} size={72} stroke={8} label={`${goal.name} ${goal.value} percent`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-section font-medium text-ink">{goal.name}</span>
                  {goal.note ? <span className="mt-0.5 block text-meta text-muted">{goal.note}</span> : null}
                  <span className="mt-1 block text-body font-medium tabular-nums text-ink">
                    {goal.amount} <span className="font-normal text-muted">of {goal.target}</span>
                  </span>
                </span>
                <Icon name="chevron" size={18} className="shrink-0 text-inactive" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );

  const detailBody = selected ? (
    <div className="px-5 py-4" data-goal-detail="true">
      <Detail goal={selected} panel showPercent={!wide} showTarget={!wide} />
      {offlineBanner("panel")}
    </div>
  ) : (
    <p className="px-5 py-4 text-body text-ink">That goal is not here.</p>
  );

  const detailPanel = (panelWide: boolean) =>
    slug ? (
      <OverlayPanel wide={panelWide} title={selected?.name || "Goal"} onClose={closeOverlay}>
        {detailBody}
      </OverlayPanel>
    ) : null;

  const addPanel = (panelWide: boolean) => (
    <OverlayPanel
      wide={panelWide}
      title="Add a goal"
      onClose={() => setAdding(false)}
      form
      slim
      sheet
      action={
        <button type="submit" form="goal-add" disabled={saving || panelOffline} className="inline-flex h-11 min-w-11 items-center justify-center px-3 text-body font-medium text-ink disabled:opacity-50">
          Save
        </button>
      }
    >
      <div className="px-5 py-4">{goalForm}</div>
    </OverlayPanel>
  );

  return (
    <div className="finance-type min-w-0 text-ink" data-ready={failed ? "error" : "true"} data-goals={failed ? "error" : empty ? "empty" : "list"} data-layout={wide ? "panel" : "sheet"}>
      {detailOnly ? (
        <header className="flex items-center gap-1 px-2 pt-2">
          <Link href="/finance/goals" aria-label="Back" className="inline-flex h-11 w-11 shrink-0 items-center justify-center">
            <Icon name="back" size={20} />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-title font-medium text-ink">{selected?.name || "Goal"}</h1>
        </header>
      ) : (
        <>
          <header className="px-5 pt-2">
            <p className="text-meta text-muted">joehub</p>
            <h1 className="text-title font-medium">Finance</h1>
          </header>
          <div className="mt-3">
            <FinanceTabs />
          </div>
        </>
      )}
      <div className={wide ? "mt-4 flex min-w-0 items-start gap-6 px-5" : "mt-4"}>
        {wide || !detailOnly ? <div className="min-w-0 flex-1">{list}</div> : null}
        {overlayOn && adding ? addPanel(wide) : null}
        {overlayOn && !adding && wide && slug ? detailPanel(true) : null}
        {overlayOn && !adding && wide && !slug ? (
          <aside className="card w-[420px] shrink-0 p-5">
            <p className="py-16 text-center text-body text-muted">Select a goal</p>
          </aside>
        ) : null}
        {!overlayOn && wide && !adding ? (
          <aside className="card w-[420px] shrink-0 p-5">
            {selected ? <Detail goal={selected} titled /> : <p className="py-16 text-center text-body text-muted">Select a goal</p>}
          </aside>
        ) : null}
        {!overlayOn && !wide && detailOnly ? (
          selected ? <Detail goal={selected} boxed /> : <p className="px-5 pt-16 text-center text-body">That goal is not here.</p>
        ) : null}
      </div>
      {overlayOn && !wide && !adding && slug ? detailPanel(false) : null}
      {!overlayOn && adding ? (
        <Sheet title="Add a goal" onClose={() => setAdding(false)} formId="goal-add" header="slim" dock={wide ? "panel" : "sheet"} saveDisabled={saving}>
          {goalForm}
        </Sheet>
      ) : null}
    </div>
  );
}
