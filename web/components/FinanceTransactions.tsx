"use client";

import { useEffect, useRef, useState } from "react";
import { CategoryMark } from "./CategoryMark";
import { FinanceTabs } from "./FinanceTabs";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

type LedgerValue = { amountCents: number; category: string | null; payee?: string };

type Row = {
  id: string;
  payee: string;
  amountCents: number;
  date: string;
  category: string | null;
  type: string;
  source: string;
  meta: string;
  corrected: boolean;
  uncategorized: boolean;
  original: LedgerValue | null;
  latest: LedgerValue | null;
  correction: LedgerValue | null;
};

type Week = {
  weekStart: string;
  label: string;
  daysLeft: number | null;
  today: string;
  previousWeek: string;
  nextWeek: string | null;
  rows: Row[];
};

const CATEGORIES = [
  ["dining-out", "Dining Out"],
  ["groceries", "Groceries"],
  ["transport", "Transport"],
  ["subscriptions", "Subscriptions"],
  ["shopping", "Shopping"],
  ["utilities", "Utilities"],
];

function money(cents: number) {
  const sign = cents < 0 ? "−" : cents > 0 ? "+" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function dollars(cents: number) {
  return (Math.abs(cents) / 100).toFixed(2);
}

function ledgerLine(value: LedgerValue | null) {
  if (!value) return "";
  const name = CATEGORIES.find(([slug]) => slug === value.category)?.[1] || "Uncategorized";
  return `${name} · ${money(value.amountCents)}`;
}

export function FinanceTransactions() {
  const [week, setWeek] = useState<Week | null>(null);
  const [wide, setWide] = useState(false);
  const [offline, setOffline] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [kind, setKind] = useState("expense");
  const [category, setCategory] = useState("dining-out");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState<Row | null>(null);
  const idem = useRef("");
  const weekRef = useRef("");

  function query(nextWeek = weekRef.current) {
    const params = new URLSearchParams(window.location.search);
    const search = new URLSearchParams();
    if (params.get("asOf")) search.set("asOf", params.get("asOf") || "");
    if (nextWeek) search.set("week", nextWeek);
    const suffix = search.toString();
    return suffix ? `?${suffix}` : "";
  }

  async function load(nextWeek = weekRef.current) {
    const response = await fetch(`/api/finance/transactions${query(nextWeek)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("transactions");
    const body = (await response.json()) as Week;
    weekRef.current = body.weekStart;
    setWeek(body);
    const params = new URLSearchParams(window.location.search);
    params.set("week", body.weekStart);
    window.history.replaceState(null, "", `/finance/transactions?${params.toString()}`);
    return body;
  }

  function show(row: Row | null, today: string) {
    setEditing(row);
    setPayee(row?.payee || "");
    setAmount(row ? dollars(row.amountCents) : "");
    setDate(row?.date || today);
    setKind(row?.type || "expense");
    setCategory(row ? row.category || "" : "dining-out");
    setError("");
    idem.current = "";
    setOpen(true);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    weekRef.current = params.get("week") || "";
    const onResize = () => setWide(window.innerWidth >= 1024);
    const onOffline = () => setOffline(true);
    const onOnline = () => setOffline(false);
    onResize();
    setOffline(!navigator.onLine);
    window.addEventListener("resize", onResize);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    void load(weekRef.current)
      .then((body) => {
        if (params.get("add") === "1" && navigator.onLine) show(null, body.today);
      })
      .catch(() => setError("Finance is unavailable."));
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  function close() {
    setOpen(false);
    setEditing(null);
    setError("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (offline || saving) {
      setError("Can’t edit offline");
      return;
    }
    const parsed = /^\d+(\.\d{1,2})?$/.test(amount.trim()) ? Math.round(Number(amount.trim()) * 100) : 0;
    if (!payee.trim()) {
      setError("Enter a name.");
      document.getElementById("txn-payee")?.focus();
      return;
    }
    if (!parsed) {
      setError("Enter an amount.");
      document.getElementById("txn-amount")?.focus();
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      payee: payee.trim(),
      amountCents: parsed,
      date,
      type: kind,
      category: kind === "expense" ? category || null : null,
    };
    try {
      if (!idem.current) idem.current = crypto.randomUUID();
      const response = await fetch(editing ? `/api/finance/transactions/${editing.id}` : "/api/finance/transactions", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json", "idempotency-key": idem.current },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as { detail?: string; field?: string };
      if (!response.ok) {
        setError(body.detail || "Couldn’t save.");
        if (body.field === "payee") document.getElementById("txn-payee")?.focus();
        if (body.field === "amount") document.getElementById("txn-amount")?.focus();
        return;
      }
      await load(weekRef.current);
      close();
    } catch {
      setError("Couldn’t save.");
    } finally {
      setSaving(false);
    }
  }

  const form = (
    <form id="finance-form" onSubmit={save} className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-5">
        <label className="block text-meta text-muted" htmlFor="txn-payee">
          Merchant
          <input id="txn-payee" value={payee} disabled={offline} data-autofocus inputMode="text" enterKeyHint="next" className="mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink" onChange={(event) => setPayee(event.target.value)} />
        </label>
        <div className="flex gap-3">
          <label className="block min-w-0 flex-1 text-meta text-muted" htmlFor="txn-amount">
            Amount
            <input id="txn-amount" inputMode="decimal" enterKeyHint="next" value={amount} disabled={offline} className="mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink" onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label className="block min-w-0 flex-1 text-meta text-muted" htmlFor="txn-date">
            Date
            <input id="txn-date" type="date" enterKeyHint="done" value={date} disabled={offline} className="mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink" onChange={(event) => setDate(event.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {["expense", "income", "transfer", "refund"].map((item) => (
            <button key={item} type="button" aria-pressed={kind === item} className={`min-h-11 min-w-11 rounded-full px-3 text-meta ${kind === item ? "bg-ink text-page" : "border border-line"}`} onClick={() => setKind(item)}>
              {item === "expense" ? "Expense" : item === "income" ? "Income" : item === "transfer" ? "Transfer" : "Refund"}
            </button>
          ))}
        </div>
        {kind === "expense" || kind === "refund" ? (
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(([slug, name]) => (
              <button key={slug} type="button" aria-pressed={category === slug} className={`min-h-11 min-w-11 rounded-full px-3 text-meta ${category === slug ? "bg-ink text-page" : "border border-line"}`} onClick={() => setCategory(slug)}>
                {name}
              </button>
            ))}
            <button type="button" aria-pressed={!category} className={`min-h-11 min-w-11 rounded-full px-3 text-meta ${!category ? "bg-ink text-page" : "border border-line"}`} onClick={() => setCategory("")}>
              Uncategorized
            </button>
          </div>
        ) : null}
        {editing?.original ? (
          <div className="rounded-2xl bg-[#2E8B6A14] px-3 py-3">
            <p className="text-meta font-medium text-[#246C53]">Original from Ledger</p>
            <p className="text-body">{ledgerLine(editing.original)}</p>
          </div>
        ) : null}
        {error ? <p className="text-body text-[#E07A5F]">{error}</p> : null}
        {offline ? <p className="text-body">Can’t edit offline</p> : null}
      </div>
      {wide ? (
        <div className="sticky bottom-0 mt-5 flex gap-3 border-t border-line bg-surface py-3">
          <button type="button" className="min-h-11 min-w-11 flex-1 rounded-xl border border-line text-body" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="min-h-11 min-w-11 flex-1 rounded-xl bg-ink text-body text-page disabled:opacity-40" disabled={offline || saving}>
            {editing?.source === "ledger" ? "Save correction" : "Save"}
          </button>
        </div>
      ) : null}
    </form>
  );

  return (
    <main className={`finance-type min-w-0 text-ink ${wide ? "flex items-start gap-6 px-6" : ""}`} data-ready={week ? "true" : undefined} data-layout={wide ? "panel" : "sheet"}>
      <div className="min-w-0 flex-1">
        <header className="px-5 pt-2">
          <p className="text-meta text-muted">joehub</p>
          <h1 className="text-title font-medium">Transactions</h1>
        </header>
        <div className="mt-3">
          <FinanceTabs />
        </div>
        {week ? (
          <>
            <div className="mt-3 flex items-center justify-between gap-2 px-2">
              <button type="button" aria-label="Previous week" className="grid h-11 w-11 place-items-center" onClick={() => void load(week.previousWeek)}>
                <Icon name="back" size={18} />
              </button>
              <div className="text-center">
                <h2 className="text-body font-medium">{week.label}</h2>
                {week.daysLeft != null ? <p className="text-meta text-muted">{week.daysLeft} days left</p> : null}
              </div>
              <button type="button" aria-label={week.nextWeek ? "Next week" : "Next week, unavailable"} disabled={!week.nextWeek} className="grid h-11 w-11 place-items-center disabled:opacity-40" onClick={() => week.nextWeek && void load(week.nextWeek)}>
                <Icon name="chevron" size={18} />
              </button>
            </div>
            <div className="px-4">
              <button type="button" className="min-h-11 w-full rounded-xl border border-line text-body disabled:opacity-40" disabled={offline} onClick={() => (offline ? setError("Can’t edit offline") : show(null, week.today))}>
                Add expense or income
              </button>
            </div>
            {offline ? <p className="px-5 pt-3 text-body">Can’t edit offline</p> : null}
            {week.rows.some((row) => row.corrected && row.latest) ? <p className="mx-5 mt-4 rounded-2xl border border-[#E9B94955] bg-[#E9B9491F] px-3.5 py-3 text-body font-medium text-[#8A6B14]">Ledger updated</p> : null}
            <h2 className="mt-4 px-5 text-section font-medium">This week</h2>
            {week.rows.length === 0 ? <p className="px-5 py-8 text-center text-body">No transactions this week</p> : null}
            <ul className="px-5">
              {week.rows.map((row) =>
                row.corrected && row.latest && row.correction && row.original ? (
                  <li key={row.id} className="my-3 rounded-2xl border border-line p-4" data-conflict={row.id}>
                    <button type="button" aria-label={`Edit ${row.payee}`} className="flex min-h-11 w-full items-center gap-3 text-left" onClick={() => show(row, week.today)}>
                      <CategoryMark category={row.category} type={row.type} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-body font-medium">
                          {row.payee} <span className="ml-1 rounded bg-[#2E8B6A1F] px-1.5 py-0.5 text-meta font-medium text-[#246C53]">Corrected</span>
                        </span>
                        <span className="block text-meta text-muted">{row.meta}</span>
                        <span className="mt-2 block text-title font-medium">{money(row.amountCents)}</span>
                      </span>
                    </button>
                    <dl className="mt-3 space-y-2 text-body">
                      <div className="flex justify-between gap-3"><dt className="text-muted">Original from Ledger</dt><dd>{ledgerLine(row.original)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-muted">Your correction</dt><dd>{ledgerLine(row.correction)}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-muted">Latest Ledger import</dt><dd>{ledgerLine(row.latest)}</dd></div>
                    </dl>
                    <button type="button" className="mt-4 min-h-11 w-full rounded-xl border border-line text-body" onClick={() => setResetting(row)}>
                      Reset to Ledger…
                    </button>
                  </li>
                ) : (
                  <li key={row.id}>
                    <button type="button" aria-label={row.payee} className="flex min-h-11 w-full items-center gap-3 border-b border-line py-2.5 text-left" onClick={() => show(row, week.today)}>
                      <CategoryMark category={row.category} type={row.type} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-body font-medium">{row.payee}</span>
                        <span className="block text-meta text-muted">
                          {row.meta}
                          {row.corrected ? <span className="ml-1 rounded bg-[#2E8B6A1F] px-1.5 py-0.5 text-meta font-medium text-[#246C53]">Corrected</span> : null}
                          {row.uncategorized ? <span className="ml-1 rounded bg-[#6B746E1F] px-1.5 py-0.5 text-meta font-medium text-muted">Uncategorized</span> : null}
                        </span>
                      </span>
                      <span className={`text-body font-medium ${row.amountCents > 0 ? "text-finance-primary" : ""}`}>{money(row.amountCents)}</span>
                    </button>
                  </li>
                ),
              )}
            </ul>
          </>
        ) : (
          <p className="px-5 py-8 text-body text-muted">{error || "Loading…"}</p>
        )}
      </div>
      {open && wide ? (
        <Sheet title={editing ? "Edit transaction" : "Add expense or income"} dock="panel" onClose={close} titleClassName="finance-type text-section font-medium">
          {form}
        </Sheet>
      ) : null}
      {open && !wide ? (
        <Sheet
          title={editing ? "Edit transaction" : "Add expense or income"}
          frame
          dock="sheet"
          formId="finance-form"
          saveLabel={saving ? "Saving…" : editing?.source === "ledger" ? "Save correction" : "Save"}
          saveDisabled={offline || saving}
          onClose={close}
          titleClassName="finance-type text-section font-medium"
        >
          {form}
        </Sheet>
      ) : null}
      {resetting ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div role="dialog" aria-modal="true" aria-label="Reset to Ledger?" className="w-full max-w-phone rounded-t-2xl bg-surface p-5 pb-8">
            <h2 className="text-section font-medium">Reset to Ledger?</h2>
            <div className="mt-4 flex gap-3">
              <button type="button" className="min-h-11 flex-1 rounded-xl border border-line text-body" onClick={() => setResetting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="min-h-11 flex-1 rounded-xl bg-ink text-body text-page"
                onClick={() => {
                  const id = resetting.id;
                  void fetch(`/api/finance/transactions/${id}/reset-ledger`, { method: "POST" })
                    .then((response) => {
                      if (!response.ok) return;
                      setResetting(null);
                      return load(weekRef.current);
                    })
                    .catch(() => undefined);
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
