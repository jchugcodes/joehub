"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { focusReturnSelector, readOverlayHold } from "../lib/overlay-motion.mjs";
import { useOverlayHolds, useOverlays } from "./LivePages";
import { FinanceTabs } from "./FinanceTabs";
import { ConfirmDialog, OverlayPanel } from "./OverlayPanel";

type Debt = {
  id: string;
  name: string;
  type: string;
  balanceCents: number;
  institution?: string;
  balanceAsOf: string | null;
  loanKind?: string;
  rateBps?: number;
  minimumCents?: number;
  nextDue?: string;
  paymentsLeft?: number;
  paymentsTotal?: number;
  notes?: string;
};

type StudentGroup = {
  name: string;
  count: number;
  totalCents: number;
  debts: Debt[];
};

type Snapshot = {
  empty?: boolean;
  totalCents: number;
  asOf: string | null;
  student: StudentGroup | null;
  debts: Debt[];
};

function money(cents: number) {
  const abs = Math.abs(cents);
  const text = (abs / 100).toFixed(2);
  const [whole, frac] = text.split(".");
  return `${cents < 0 ? "−" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
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

function dueParts(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dueShort(ymd: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(dueParts(ymd));
}

function dueLong(ymd: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(dueParts(ymd));
}

function rateText(bps: number) {
  return `${(bps / 100).toFixed(2)}%`;
}

function typeLabel(debt: Debt) {
  if (debt.loanKind) return debt.loanKind;
  if (debt.type === "credit card") return "Credit card";
  if (debt.type === "installment") return "Installment";
  if (debt.type === "student") return "Student loan";
  return "Loan";
}

function metaLine(debt: Debt) {
  if (debt.loanKind && Number.isInteger(debt.rateBps)) return `${debt.loanKind} · ${rateText(debt.rateBps!)}`;
  if (Number.isInteger(debt.paymentsLeft) && Number.isInteger(debt.paymentsTotal) && debt.nextDue) {
    return `${debt.paymentsLeft} of ${debt.paymentsTotal} left · due ${dueShort(debt.nextDue)}`;
  }
  if (debt.type === "credit card") return "Credit card";
  if (debt.institution) return debt.institution;
  return typeLabel(debt);
}

function centsFromInput(value: string) {
  const text = value.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 100_000_000) return null;
  return cents;
}

function Glyph({ type, size = 40 }: { type: string; size?: number }) {
  const card = type === "credit card";
  const installment = type === "installment";
  const tone = card ? "#E07A5F" : installment ? "#5B6B8C" : "#C2577A";
  const icon = size >= 40 ? 19 : 15;
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, background: `${tone}1F` }}>
      {card ? (
        <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke={tone} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20M6 15h4" />
        </svg>
      ) : installment ? (
        <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke={tone} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M8 9h8M8 13h5" />
        </svg>
      ) : (
        <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke={tone} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21V8l9-5 9 5v13" />
          <path d="M9 21v-8h6v8" />
        </svg>
      )}
    </span>
  );
}

function Chevron({ direction }: { direction: "right" | "down" | "up" }) {
  const path = direction === "right" ? "M9 6l6 6-6 6" : direction === "down" ? "M6 9l6 6 6-6" : "M18 15l-6-6-6 6";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function fieldRows(debt: Debt) {
  return [
    Number.isInteger(debt.rateBps) ? ["Interest rate", rateText(debt.rateBps!)] : null,
    Number.isInteger(debt.minimumCents) ? ["Minimum payment", money(debt.minimumCents!)] : null,
    debt.nextDue ? ["Next due", dueLong(debt.nextDue)] : null,
    debt.institution ? ["Servicer", debt.institution] : null,
    Number.isInteger(debt.paymentsLeft) && Number.isInteger(debt.paymentsTotal) ? ["Payments left", `${debt.paymentsLeft} of ${debt.paymentsTotal}`] : null,
  ].filter((row): row is string[] => Boolean(row));
}

function Detail({ debt, titled = false }: { debt: Debt; titled?: boolean }) {
  return (
    <div>
      {titled ? <h2 className="text-title font-medium">{debt.name}</h2> : null}
      <p className={`text-body text-muted ${titled ? "mt-0.5" : ""}`}>{typeLabel(debt)}</p>
      <p className="mt-3 text-meta text-muted">Balance</p>
      <p className="mt-0.5 text-title font-medium tabular-nums">{money(debt.balanceCents)}</p>
      {debt.balanceAsOf ? <p className="mt-1 text-meta text-muted">As of {stamp(debt.balanceAsOf)}</p> : null}
      <dl className="card mt-4 divide-y divide-line">
        {fieldRows(debt).map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 px-4 py-3 text-body">
            <dt className="text-muted">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function FinanceDebts({ selectedId = "" }: { selectedId?: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const overlayOn = useOverlays();
  const overlayHold = readOverlayHold(search, useOverlayHolds());
  const asOf = search.get("asOf") || "";
  const previewEmpty = search.get("view") === "empty" || overlayHold === "empty";
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  const [wide, setWide] = useState(false);
  const [tone, setTone] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("");
  const [institution, setInstitution] = useState("");
  const formDomId = useId();

  const query = new URLSearchParams();
  if (asOf) query.set("asOf", asOf);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const listHref = `/finance/debts${suffix}`;
  const panelOffline = overlayHold === "offline" || tone === "offline";

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (asOf) params.set("asOf", asOf);
    const listed = await fetch(`/api/finance/debts${params.size ? `?${params}` : ""}`, { cache: "no-store" });
    if (!listed.ok) throw new Error("debts");
    const body = (await listed.json()) as Snapshot;
    setSnapshot(body);
    return body;
  }, [asOf]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const apply = () => setWide(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!overlayOn) return;
    if (selectedId) return;
    const back = sessionStorage.getItem("joehub.debts.return");
    if (!back) return;
    const selector = focusReturnSelector(back);
    const link = selector ? document.querySelector(selector) : null;
    if (link instanceof HTMLElement) link.focus();
    sessionStorage.removeItem("joehub.debts.return");
  }, [overlayOn, selectedId]);

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
    let gone = false;
    load().catch(() => {
      if (gone) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) setTone("offline");
      else setSnapshot(null);
    });
    return () => {
      gone = true;
    };
  }, [load]);

  const students = snapshot?.student?.debts || [];
  const selected = [...students, ...(snapshot?.debts || [])].find((debt) => debt.id === selectedId) || null;
  const expanded = open === null ? Boolean(selected && selected.type === "student") : open;
  const empty = previewEmpty || Boolean(snapshot && (snapshot.empty || (snapshot.debts.length === 0 && !snapshot.student)));

  function closeOverlay() {
    if (selectedId) sessionStorage.setItem("joehub.debts.return", selectedId);
    setEditing(false);
    setConfirming(false);
    setError("");
    router.push(listHref);
  }

  function closeForm() {
    setEditing(false);
    setError("");
  }

  function openEdit(debt: Debt) {
    if (panelOffline) return;
    setName(debt.name);
    setBalance((Math.abs(debt.balanceCents) / 100).toFixed(2));
    setInstitution(debt.institution || "");
    setError("");
    setConfirming(false);
    setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected || panelOffline || saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name required.");
      return;
    }
    const cents = centsFromInput(balance);
    if (cents == null) {
      setError("Enter a valid balance.");
      return;
    }
    setSaving(true);
    setError("");
    const response = await fetch(`/api/finance/accounts/${selected.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: trimmed,
        type: selected.type,
        balanceCents: selected.balanceCents < 0 ? -cents : cents,
        institution: institution.trim(),
      }),
    });
    setSaving(false);
    if (!response.ok) {
      const failed = (await response.json().catch(() => null)) as { detail?: string } | null;
      setError(failed?.detail || "Couldn’t save that debt.");
      return;
    }
    closeForm();
    await load();
  }

  async function remove() {
    if (!selected || panelOffline || saving) return;
    setSaving(true);
    const response = await fetch(`/api/finance/accounts/${selected.id}`, { method: "DELETE" });
    setSaving(false);
    if (!response.ok) {
      const failed = (await response.json().catch(() => null)) as { detail?: string } | null;
      setError(failed?.detail || "Couldn’t delete that debt.");
      return;
    }
    setConfirming(false);
    setEditing(false);
    setError("");
    router.push(listHref);
    await load();
  }

  function rowClass(id: string, nested: boolean) {
    const selectedRow = id === selectedId;
    const tint = selectedRow ? (overlayOn ? "row-selected" : "bg-[#2E8B6A14]") : "";
    return `flex min-h-11 w-full items-center gap-3 text-left text-ink ${nested ? "py-2.5 pl-2" : "py-3"} ${tint}`;
  }

  const list = (
    <div className={wide ? "" : "px-5"}>
      {overlayOn && panelOffline ? (
        <p role="status" data-state="offline" className="mb-3 rounded-2xl bg-table-header px-4 py-3 text-left text-body text-ink dark:bg-white/10">
          You are offline.
        </p>
      ) : null}
      {!snapshot && !previewEmpty ? <p className="py-8 text-body text-muted">Loading debts…</p> : null}
      {snapshot && empty ? (
        <p className="py-16 text-center text-section font-medium">No debts</p>
      ) : null}
      {snapshot && !empty ? (
        <div className="card px-4 py-1">
          <div className="pb-2 pt-3">
            <p className="text-meta text-muted">Total debt</p>
            <p className="mt-0.5 text-title font-medium tabular-nums" data-total-debt={snapshot.totalCents}>{money(snapshot.totalCents)}</p>
            {snapshot.asOf ? <p className="mt-1 text-meta text-muted">As of {stamp(snapshot.asOf)}</p> : null}
          </div>
          {snapshot.student ? (
            <div className="border-t border-line">
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-3 py-3 text-left"
                aria-expanded={expanded}
                onClick={() => setOpen(!expanded)}
              >
                <Glyph type="student" />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium">Student loans</span>
                  <span className="mt-0.5 block text-meta text-muted">{snapshot.student.count} loans</span>
                </span>
                <span className="shrink-0 text-body font-medium tabular-nums">{money(snapshot.student.totalCents)}</span>
                <Chevron direction={expanded ? "up" : "down"} />
              </button>
              {expanded ? (
                <div className="border-t border-line pl-2">
                  {snapshot.student.debts.map((debt) => (
                    <Link
                      key={debt.id}
                      href={`/finance/debts/${debt.id}${suffix}`}
                      aria-current={debt.id === selectedId ? "true" : undefined}
                      data-debt={debt.id}
                      className={rowClass(debt.id, true)}
                    >
                      <Glyph type="student" size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium">{debt.name}</span>
                        <span className="mt-0.5 block truncate text-meta text-muted">{metaLine(debt)}</span>
                      </span>
                      <span className="shrink-0 text-body font-medium tabular-nums">{money(debt.balanceCents)}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {snapshot.debts.map((debt) => (
            <div key={debt.id} className="border-t border-line">
              <Link
                href={`/finance/debts/${debt.id}${suffix}`}
                aria-current={debt.id === selectedId ? "true" : undefined}
                data-debt={debt.id}
                className={rowClass(debt.id, false)}
              >
                <Glyph type={debt.type} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium">{debt.name}</span>
                  <span className="mt-0.5 block truncate text-meta text-muted">{metaLine(debt)}</span>
                </span>
                <span className="shrink-0 text-body font-medium tabular-nums">{money(debt.balanceCents)}</span>
                <Chevron direction="right" />
              </Link>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  const offlineBanner = panelOffline ? (
    <p role="status" data-state="offline" className="mt-4 rounded-2xl bg-table-header px-4 py-3 text-left text-body text-ink dark:bg-white/10">
      You are offline.
    </p>
  ) : null;

  const editForm = selected ? (
    <form id={formDomId} onSubmit={save} className="min-w-0">
      <label className="mb-4 block">
        <span className="mb-1.5 block text-body">Name</span>
        <input
          id="debt-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
          data-autofocus="true"
          className="h-[52px] w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink outline-none focus:border-2 focus:border-ink"
        />
      </label>
      <label className="mb-4 block">
        <span className="mb-1.5 block text-body">Balance</span>
        <input
          value={balance}
          onChange={(event) => setBalance(event.target.value)}
          inputMode="decimal"
          className="h-[52px] w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink outline-none focus:border-2 focus:border-ink"
        />
      </label>
      <label className="mb-4 block">
        <span className="mb-1.5 block text-body">Servicer</span>
        <input
          value={institution}
          onChange={(event) => setInstitution(event.target.value)}
          autoComplete="off"
          className="h-[52px] w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink outline-none focus:border-2 focus:border-ink"
        />
      </label>
      {error && !confirming ? <p role="alert" className="mb-3 text-meta font-medium text-warn">{error}</p> : null}
      <button
        type="button"
        disabled={panelOffline || saving}
        onClick={() => {
          if (!panelOffline) setConfirming(true);
        }}
        className="mt-2 flex min-h-11 items-center text-body font-medium disabled:opacity-40"
        style={{ color: "var(--ink)" }}
      >
        Delete
      </button>
    </form>
  ) : null;

  const overlayBody = selected ? (
    <div className="px-5 py-4" data-debt-detail={editing ? undefined : "true"}>
      {editing ? (
        <>
          {editForm}
          {offlineBanner}
        </>
      ) : overlayHold === "error" ? (
        <p role="alert" className="text-body">Couldn’t load that debt.</p>
      ) : (
        <>
          <span data-debt-type={typeLabel(selected)} className="inline-flex shrink-0 rounded-full px-2.5 py-1 text-meta font-medium" style={{ color: "var(--ink)", background: "var(--table-header)" }}>
            {typeLabel(selected)}
          </span>
          <p data-item-meta="true" className="mt-2 text-meta text-muted">{metaLine(selected)}</p>
          {selected.notes ? <p className="mt-3 text-body">{selected.notes}</p> : <p className="mt-3 text-body text-muted" data-state="empty">No notes.</p>}
          <p className="mt-4 text-meta text-muted">Balance</p>
          <p className="mt-0.5 text-title font-medium tabular-nums" data-debt-balance={selected.balanceCents}>{money(selected.balanceCents)}</p>
          {selected.balanceAsOf ? <p className="mt-1 text-meta text-muted">As of {stamp(selected.balanceAsOf)}</p> : null}
          <dl className="mt-4 divide-y divide-line">
            {fieldRows(selected).map(([label, value]) => (
              <div key={label} className="flex min-h-11 items-center justify-between gap-4 text-body">
                <dt className="text-muted">{label}</dt>
                <dd className="font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            data-primary="edit"
            disabled={panelOffline}
            onClick={() => openEdit(selected)}
            className="mt-5 flex h-11 w-full items-center justify-center rounded-xl bg-ink px-4 text-body font-medium text-page disabled:opacity-40"
          >
            Edit
          </button>
          {offlineBanner}
        </>
      )}
    </div>
  ) : null;

  const panel = (panelWide: boolean) =>
    selected ? (
      <OverlayPanel
        wide={panelWide}
        depth={editing ? 1 : 0}
        title={editing ? "Edit debt" : selected.name}
        onClose={closeOverlay}
        onBack={editing ? closeForm : undefined}
        form={editing}
        confirming={confirming}
        slim={editing}
        sheet={editing}
        action={editing ? (
          <button type="submit" form={formDomId} disabled={panelOffline || saving} className="inline-flex h-11 min-w-11 items-center justify-center bg-transparent p-0 disabled:opacity-50">
            <span className="inline-flex h-8 items-center justify-center rounded-xl bg-ink px-3.5 text-body font-medium text-page">{saving ? "Saving…" : "Save"}</span>
          </button>
        ) : null}
      >
        {overlayBody}
      </OverlayPanel>
    ) : null;

  return (
    <main className="finance-type min-w-0 text-ink" data-ready={snapshot ? "true" : undefined} data-debts={empty ? "empty" : "list"} data-layout={wide ? "panel" : "sheet"}>
      {wide || !selected || overlayOn ? (
        <>
          <header className="px-5 pt-2">
            <p className="text-meta text-muted">joehub</p>
            <h1 className="text-title font-medium">Finance</h1>
          </header>
          <div className="mt-3">
            <FinanceTabs />
          </div>
        </>
      ) : (
        <header className="flex items-center gap-1 px-2 pt-2">
          <Link href={listHref} aria-label="Back" className="inline-flex h-11 w-11 shrink-0 items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-title font-medium">{selected.name}</h1>
        </header>
      )}
      <div className={wide ? "mt-4 flex min-w-0 items-start gap-6 px-4" : "mt-4"}>
        {wide || !selected || overlayOn ? <div className="min-w-0 flex-1">{list}</div> : null}
        {overlayOn && wide && selected ? panel(true) : null}
        {overlayOn && wide && !selected ? (
          <aside className="card w-[420px] shrink-0 p-8" style={{ minHeight: 520 }}>
            <p className="pt-8 text-center text-body text-muted">Select a debt</p>
          </aside>
        ) : null}
        {!overlayOn && wide ? (
          <aside className="card w-[420px] shrink-0 p-8" style={{ minHeight: 520 }}>
            {selected ? <Detail debt={selected} titled /> : <p className="pt-8 text-center text-body text-muted">Select a debt</p>}
          </aside>
        ) : null}
        {!overlayOn && !wide && selected ? (
          <div className="px-5">
            <Detail debt={selected} />
          </div>
        ) : null}
      </div>
      {overlayOn && !wide && selected ? panel(false) : null}
      {overlayOn && confirming && selected ? (
        <ConfirmDialog
          title="Delete this debt?"
          detail={selected.name}
          error={error}
          confirmDisabled={panelOffline || saving}
          onCancel={() => {
            setConfirming(false);
            setError("");
          }}
          onConfirm={() => void remove()}
        />
      ) : null}
    </main>
  );
}
