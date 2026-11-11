"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CategoryMark } from "./CategoryMark";
import { FinanceTabs } from "./FinanceTabs";
import { Sheet } from "./Sheet";

type Account = {
  id: string;
  name: string;
  type: string;
  source: "ledger" | "manual";
  balanceCents: number;
  institution?: string;
  hiddenFromNetWorth: boolean;
  estimate?: boolean;
  stale: boolean;
  group: string;
  balanceAsOf: string | null;
};

type Snapshot = {
  netWorthCents: number | null;
  assetsCents: number | null;
  liabilitiesCents: number | null;
  updatedAt: string | null;
  empty?: boolean;
  accounts: Account[];
};

type Txn = { id: string; payee: string; amountCents: number; category: string | null; type: string; meta: string };

const TYPES = ["checking", "savings", "credit card", "loan", "brokerage"] as const;
const TYPE_LABEL: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  "credit card": "Credit card",
  loan: "Loan",
  brokerage: "Brokerage",
  cash: "Savings",
  investment: "Brokerage",
};
const GROUP_ORDER = ["Banking", "Investments", "Cards", "Loans", "Other", "Hidden"];
const LOAN_TYPES = new Set(["loan", "installment", "student"]);

function money(cents: number) {
  const abs = Math.abs(cents);
  const text = (abs / 100).toFixed(2);
  const [whole, frac] = text.split(".");
  return `${cents < 0 ? "−" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

function wholeDollars(cents: number) {
  return `${cents < 0 ? "−" : ""}$${Math.trunc(Math.abs(cents) / 100).toLocaleString("en-US")}`;
}

function asOfDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Detroit", month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

const COLLAPSE_AT = 5;

function signed(cents: number) {
  return `${cents < 0 ? "−" : "+"}${money(cents)}`;
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

function centsFromInput(value: string) {
  const text = value.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 100_000_000) return null;
  return cents;
}

function sourceLine(account: Account) {
  if (account.source === "ledger") return account.institution ? `Ledger · ${account.institution}` : "Ledger";
  return "Manual";
}

function AccountGlyph({ type }: { type: string }) {
  const loan = LOAN_TYPES.has(type);
  const invested = type === "brokerage" || type === "investment" || type === "retirement" || type === "crypto";
  const tone = type === "credit card" ? "#E07A5F" : loan ? "#C2577A" : invested ? "#3A86C8" : "#2E8B6A";
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: tone, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: `${tone}1F` }}>
      {type === "credit card" ? (
        <svg {...common}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></svg>
      ) : loan ? (
        <svg {...common}><path d="M3 21V8l9-5 9 5v13M9 21v-8h6v8" /></svg>
      ) : invested ? (
        <svg {...common}><path d="M3 17l6-6 4 4 8-8M15 7h6v6" /></svg>
      ) : type === "checking" ? (
        <svg {...common}><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M16 13h2M3 10h18M6 6V4h11v2" /></svg>
      ) : (
        <svg {...common}><path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
      )}
    </span>
  );
}

function HideSwitch({ on, disabled, onToggle }: { on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label="Hide from net worth" disabled={disabled} onClick={onToggle} className="inline-flex min-h-11 min-w-11 items-center justify-end disabled:opacity-40">
      <span className={`relative h-[31px] w-[51px] rounded-full ${on ? "bg-ink" : "bg-[#C9CEC8]"}`}>
        <span className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow ${on ? "left-[22px]" : "left-[2px]"}`} />
      </span>
    </button>
  );
}

export function FinanceAccounts({ selectedId = "" }: { selectedId?: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const asOf = search.get("asOf") || "";
  const fromMore = search.get("from") === "more";
  const previewEmpty = search.get("view") === "empty";
  const previewLink = search.get("link") || "";
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [rows, setRows] = useState<Txn[]>([]);
  const [wide, setWide] = useState(false);
  const [tone, setTone] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"" | "add" | "edit">("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("checking");
  const [balance, setBalance] = useState("");
  const [institution, setInstitution] = useState("");
  const [hideDraft, setHideDraft] = useState(false);
  const idem = useRef("");
  const savingRef = useRef(false);
  const backTimer = useRef<number | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const formDomId = useId();
  const blocked = tone === "offline" || tone === "reconnecting" || previewLink === "offline" || previewLink === "reconnecting";

  const query = new URLSearchParams();
  if (asOf) query.set("asOf", asOf);
  if (fromMore) query.set("from", "more");
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const listHref = `/finance/accounts${suffix}`;

  const load = useCallback(async () => {
    const accountQuery = new URLSearchParams();
    if (asOf) accountQuery.set("asOf", asOf);
    const listed = await fetch(`/api/finance/accounts${accountQuery.size ? `?${accountQuery}` : ""}`, { cache: "no-store" });
    if (!listed.ok) throw new Error("accounts");
    const body = (await listed.json()) as Snapshot;
    setSnapshot(body);
    if (selectedId) {
      const txnQuery = new URLSearchParams({ accountId: selectedId });
      if (asOf) txnQuery.set("asOf", asOf);
      const txns = await fetch(`/api/finance/transactions?${txnQuery}`, { cache: "no-store" });
      setRows(txns.ok ? ((await txns.json()).rows as Txn[]) : []);
    } else {
      setRows([]);
    }
    return body;
  }, [asOf, selectedId]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const apply = () => setWide(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    let gone = false;
    void load()
      .catch(() => {
        if (!gone && !navigator.onLine) setTone("offline");
      });
    return () => {
      gone = true;
    };
  }, [load]);

  useEffect(() => {
    const refresh = async () => {
      setNotice("");
      setTone("reconnecting");
      try {
        await load();
        setNotice("");
        setTone("back");
        if (backTimer.current) window.clearTimeout(backTimer.current);
        backTimer.current = window.setTimeout(() => setTone(""), 3000);
      } catch {
        setTone("offline");
      }
    };
    const onOffline = () => setTone("offline");
    const onOnline = () => void refresh();
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      if (backTimer.current) window.clearTimeout(backTimer.current);
    };
  }, [load]);

  useEffect(() => {
    if (!mode) return;
    const timer = window.setTimeout(() => document.querySelector<HTMLElement>("[data-autofocus]")?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && wide && !confirming) {
        event.preventDefault();
        setMode("");
        setError("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
    };
  }, [mode, wide, confirming]);

  useEffect(() => {
    if (!confirming) return;
    const node = confirmRef.current;
    const items = () => [...(node?.querySelectorAll<HTMLElement>("button") ?? [])];
    items()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setConfirming(false);
        return;
      }
      if (event.key !== "Tab") return;
      event.stopImmediatePropagation();
      const buttons = items();
      if (buttons.length < 2) return;
      const [first, second] = buttons;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        second.focus();
      } else if (!event.shiftKey && document.activeElement === second) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [confirming]);

  const accounts = snapshot?.accounts ?? [];
  const selected = accounts.find((account) => account.id === selectedId) || null;
  const empty = previewEmpty || Boolean(snapshot && (snapshot.empty || accounts.length === 0));
  const shownTone = previewLink || tone;
  const balanceOk = centsFromInput(balance) != null;
  const canSave = name.trim().length > 0 && balanceOk && !saving && !blocked;

  function openAdd() {
    if (blocked) {
      setNotice("Can’t edit offline");
      return;
    }
    idem.current = crypto.randomUUID();
    setName("");
    setType("checking");
    setBalance("");
    setInstitution("");
    setHideDraft(false);
    setError("");
    setMode("add");
  }

  function openEdit(account: Account) {
    if (blocked) {
      setNotice("Can’t edit offline");
      return;
    }
    if (account.source !== "manual") return;
    setName(account.name);
    setType((TYPES as readonly string[]).includes(account.type) ? (account.type as (typeof TYPES)[number]) : "checking");
    setBalance(money(account.balanceCents));
    setInstitution(account.institution || "");
    setHideDraft(account.hiddenFromNetWorth);
    setError("");
    setMode("edit");
  }

  function closeForm() {
    setMode("");
    setError("");
    setConfirming(false);
  }

  async function toggleHide(account: Account) {
    if (blocked) {
      setNotice("Can’t edit offline");
      return;
    }
    setNotice("");
    const response = await fetch(`/api/finance/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hiddenFromNetWorth: !account.hiddenFromNetWorth }),
    });
    if (!response.ok) {
      setNotice("Couldn’t update that account.");
      return;
    }
    await load();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (blocked) {
      setNotice("Can’t edit offline");
      return;
    }
    if (!name.trim()) {
      setError("Name required.");
      return;
    }
    const cents = centsFromInput(balance);
    if (cents == null) {
      setError("Enter a valid balance.");
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    const body = { name: name.trim(), type, balanceCents: cents, institution: institution.trim(), hiddenFromNetWorth: hideDraft };
    const editing = mode === "edit" && selected?.source === "manual";
    const response = await fetch(editing ? `/api/finance/accounts/${selected.id}` : "/api/finance/accounts", {
      method: editing ? "PATCH" : "POST",
      headers: { "content-type": "application/json", ...(editing ? {} : { "idempotency-key": idem.current }) },
      body: JSON.stringify(body),
    });
    savingRef.current = false;
    setSaving(false);
    if (!response.ok) {
      const failed = (await response.json().catch(() => null)) as { detail?: string } | null;
      setError(failed?.detail || "Couldn’t save that account.");
      return;
    }
    const saved = (await response.json()) as Account;
    closeForm();
    if (!editing) router.push(`/finance/accounts/${saved.id}${suffix}`);
    await load();
  }

  async function remove() {
    if (!selected || selected.source !== "manual" || blocked) return;
    const response = await fetch(`/api/finance/accounts/${selected.id}`, { method: "DELETE" });
    if (!response.ok) {
      setConfirming(false);
      setNotice("Couldn’t delete that account.");
      return;
    }
    setConfirming(false);
    closeForm();
    router.push(listHref);
    await load();
  }

  function groups() {
    return GROUP_ORDER.map((name) => {
      const rowsInGroup = accounts.filter((account) => account.group === name);
      const total = rowsInGroup.reduce((sum, account) => sum + account.balanceCents, 0);
      return { name, rows: rowsInGroup, total };
    }).filter((group) => group.rows.length);
  }

  const form = (
    <form id={formDomId} onSubmit={save} className="min-w-0">
      <label className="mb-4 block">
        <span className="mb-1.5 block text-body">Name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (!name.trim()) setError("Name required.");
          }}
          placeholder="Account name"
          autoComplete="off"
          inputMode="text"
          enterKeyHint="next"
          data-autofocus="true"
          className="h-[52px] w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink outline-none focus:border-2 focus:border-ink"
        />
      </label>
      <p className="mb-2 text-body">Type</p>
      <div className="flex flex-wrap gap-2">
        {TYPES.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={type === item}
            onClick={() => setType(item)}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-body font-medium ${type === item ? "border-ink bg-ink text-white" : "border-line text-muted"}`}
          >
            {TYPE_LABEL[item]}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="min-w-0">
          <span className="mb-1.5 block text-body">Balance</span>
          <input
          value={balance}
          onChange={(event) => setBalance(event.target.value)}
          onBlur={() => {
            if (balance.trim() && centsFromInput(balance) == null) setError("Enter a valid balance.");
          }}
          placeholder="$0.00"
            inputMode="decimal"
            enterKeyHint="next"
            className="h-[52px] w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink outline-none focus:border-2 focus:border-ink"
          />
        </label>
        <label className="min-w-0">
          <span className="mb-1.5 block text-body">Institution</span>
          <input
            value={institution}
            onChange={(event) => setInstitution(event.target.value)}
            inputMode="text"
            enterKeyHint="done"
            className="h-[52px] w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink outline-none focus:border-2 focus:border-ink"
          />
        </label>
      </div>
      {mode === "edit" ? (
        <div className="mt-2 flex min-h-14 items-center justify-between gap-3">
          <span className="text-body font-medium">Hide from net worth</span>
          <HideSwitch on={hideDraft} disabled={blocked} onToggle={() => setHideDraft((value) => !value)} />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-body text-finance-dining">
          {error}
        </p>
      ) : null}
    </form>
  );

  const detail = selected ? (
    <div className="min-w-0">
      <p className="text-title font-medium tabular-nums">{money(selected.balanceCents)}</p>
      <p className="mt-1 text-meta text-muted">{sourceLine(selected)}</p>
      {selected.estimate || selected.stale || (selected.type === "loan" && selected.balanceAsOf) ? (
        <p className="mt-2">
          {selected.estimate ? <span className="mr-2 rounded bg-line px-1.5 py-0.5 text-meta font-medium text-muted">est.</span> : null}
          {selected.stale ? <span className="rounded bg-finance-dining/10 px-1.5 py-0.5 text-meta font-medium text-finance-dining">Stale</span> : null}
          {selected.balanceAsOf && (selected.stale || LOAN_TYPES.has(selected.type)) ? (
            <span className="ml-2 text-meta text-muted">{LOAN_TYPES.has(selected.type) && !selected.stale ? `As of ${asOfDate(selected.balanceAsOf)}` : stamp(selected.balanceAsOf)}</span>
          ) : null}
        </p>
      ) : null}
      <div className="mt-4 flex min-h-14 items-center justify-between gap-3 rounded-[20px] border border-line bg-surface px-4">
        <span className="text-body font-medium">Hide from net worth</span>
        <HideSwitch on={selected.hiddenFromNetWorth} disabled={blocked} onToggle={() => void toggleHide(selected)} />
      </div>
      <h2 className="mt-5 text-section font-medium">Recent</h2>
      {rows.length ? (
        <ul>
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 py-2.5">
              <CategoryMark category={row.category} type={row.type} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">{row.payee}</span>
                <span className="mt-0.5 block text-meta text-muted">{row.meta}</span>
              </span>
              <span className={`shrink-0 text-body font-medium tabular-nums ${row.amountCents > 0 ? "text-finance-positive" : ""}`}>{signed(row.amountCents)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted">No transactions</p>
      )}
    </div>
  ) : null;

  const net = snapshot && snapshot.netWorthCents != null ? snapshot : null;

  const bannerInset = wide || selected ? "mt-3" : "mx-4 mt-3";
  const statusBanners = (
    <>
      {shownTone === "offline" && snapshot?.updatedAt ? (
        <p role="status" data-offline="true" data-link="offline" className={`${bannerInset} flex items-start gap-2.5 rounded-2xl bg-[#E6E8E4] px-3.5 py-3`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mt-0.5 shrink-0" aria-hidden="true">
            <path d="M2 8.82A15 15 0 0 1 12 5c2.5 0 4.85.6 6.94 1.66M5 12.5A10 10 0 0 1 12 10c1.6 0 3.1.37 4.45 1.03M8.5 16a5 5 0 0 1 7 0M12 20h.01M2 2l20 20" />
          </svg>
          <span>
            <span className="block text-body font-medium">Offline</span>
            <span className="mt-0.5 block text-meta text-muted">Last updated {stamp(snapshot.updatedAt)} America/Detroit</span>
          </span>
        </p>
      ) : null}
      {shownTone === "reconnecting" ? (
        <p role="status" data-offline="true" data-link="reconnecting" className={`${bannerInset} rounded-2xl border border-[#E9B94933] bg-[#E9B9491F] px-3.5 py-3 text-body font-medium text-[#8A6B14]`}>
          Reconnecting…
        </p>
      ) : null}
      {shownTone === "back" ? (
        <p role="status" data-link="back" className={`${bannerInset} flex items-center justify-between gap-3 rounded-2xl border border-[#2E8B6A33] bg-[#2E8B6A1F] px-3.5 py-3 text-body font-medium text-[#246C53]`}>
          <span>Back online</span>
          <button type="button" className="min-h-11 px-2 text-meta font-medium text-muted" onClick={() => setTone("")}>
            Dismiss
          </button>
        </p>
      ) : null}
    </>
  );

  return (
    <main className="finance-type min-w-0 text-ink" data-from={fromMore ? "more" : "finance"} data-ready={snapshot ? "true" : undefined} data-accounts={empty ? "empty" : "list"}>
      {wide || !selected ? (
        <>
          <header className="flex items-center justify-between px-5 pt-2">
            <div>
              {fromMore ? (
                <Link href="/more#accounts" className="inline-flex min-h-11 items-center pr-2 text-body">
                  ‹ More
                </Link>
              ) : null}
              <p className="text-meta text-muted">joehub</p>
              <h1 className="text-title font-medium">Accounts</h1>
            </div>
            <button type="button" aria-label="Add a manual account" aria-disabled={blocked || undefined} onClick={openAdd} className={`min-h-11 min-w-11 px-2 text-body font-medium ${blocked ? "text-muted opacity-50" : "text-finance-primary"}`}>
              Add
            </button>
          </header>
          <div className="mt-3">
            <FinanceTabs />
          </div>
        </>
      ) : (
        <header className="flex items-center gap-1 px-2 pt-2">
          <Link href={listHref} aria-label="Back to Accounts" className="inline-flex h-11 w-11 shrink-0 items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-title font-medium">{selected?.name || "Account"}</h1>
          {selected?.source === "manual" ? (
            <button type="button" aria-disabled={blocked || undefined} onClick={() => openEdit(selected)} className={`min-h-11 px-3 text-body font-medium ${blocked ? "text-muted opacity-50" : "text-finance-primary"}`}>
              Edit
            </button>
          ) : null}
        </header>
      )}

      <div className={wide ? "mt-3 flex min-w-0 items-start gap-4 px-4" : ""}>
        {wide || !selected ? (
          <div className="min-w-0 flex-1">
            {statusBanners}
            {!snapshot ? <p className="px-5 py-8 text-body text-muted">Loading accounts…</p> : null}
            {snapshot && empty ? (
              <div className="px-5 py-16 text-center">
                <p className="text-section font-medium">No accounts yet</p>
                <button type="button" onClick={openAdd} className="mx-auto mt-5 inline-flex min-h-12 min-w-[200px] items-center justify-center rounded-xl bg-ink px-4 text-body font-medium text-white">
                  Add a manual account
                </button>
              </div>
            ) : null}
            {snapshot && !empty && net ? (
              <section className={`${wide ? "" : "mx-4"} ${shownTone ? "mt-3" : ""} rounded-[20px] border border-line bg-surface p-4`}>
                <p className="text-meta text-muted">Net worth</p>
                <p className="mt-1 font-medium tabular-nums" data-net-worth={net.netWorthCents}>
                  <span className="text-title">{wholeDollars(net.netWorthCents!)}</span>
                  <span className="text-section">.{String(Math.abs(net.netWorthCents!) % 100).padStart(2, "0")}</span>
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <p className="text-meta text-muted">
                    Assets
                    <span className="mt-1 block text-section font-medium text-ink">{money(net.assetsCents || 0)}</span>
                  </p>
                  <p className="text-meta text-muted">
                    Liabilities
                    <span className="mt-1 block text-section font-medium text-ink">{money(net.liabilitiesCents || 0)}</span>
                  </p>
                </div>
                {snapshot.updatedAt ? <p className="mt-3 text-meta text-muted">Updated {stamp(snapshot.updatedAt)}</p> : null}
              </section>
            ) : null}
            {shownTone === "offline" && snapshot ? (
              <p role="status" className={`${bannerInset} rounded-2xl border border-[#C9CEC8] bg-surface px-3.5 py-3 text-body font-medium`}>
                Can’t edit offline
              </p>
            ) : null}
            {snapshot && !empty
              ? groups().map((group) => {
                  const longLoans = group.name === "Loans" && group.rows.length > COLLAPSE_AT;
                  const holdsSelection = longLoans && group.rows.some((account) => account.id === selectedId);
                  const expanded = !longLoans || Boolean(openGroups.Loans) || holdsSelection;
                  const visible = expanded ? group.rows : [];
                  return (
                  <section key={group.name}>
                    <div className={`mt-5 flex items-baseline justify-between ${wide ? "" : "px-5"}`}>
                      <h2 className={`text-section font-medium ${group.name === "Hidden" ? "text-muted" : "text-ink"}`}>{group.name}</h2>
                      <p className={`text-section font-medium tabular-nums ${group.name === "Hidden" ? "text-muted" : "text-ink"}`}>{money(group.total)}</p>
                    </div>
                    {longLoans && !expanded ? (
                      <div className={`${wide ? "mt-2" : "mx-4 mt-2"} overflow-hidden rounded-[20px] border border-line bg-surface`}>
                        <button
                          type="button"
                          data-loans="show"
                          className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left text-body font-medium text-ink"
                          onClick={() => setOpenGroups((current) => ({ ...current, Loans: true }))}
                        >
                          <span className="min-w-0 flex-1">Show {group.rows.length} loans</span>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted" aria-hidden="true">
                            <path d="M9 6l6 6-6 6" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                    <ul className={`${wide ? "mt-2" : "mx-4 mt-2"} divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-surface`}>
                      {visible.map((account) => {
                        const current = account.id === selectedId;
                        return (
                          <li key={account.id} className={account.hiddenFromNetWorth ? "opacity-60" : ""}>
                            <Link
                              href={`/finance/accounts/${account.id}${suffix}`}
                              aria-current={current ? "true" : undefined}
                              className={`flex min-h-14 items-center gap-3 px-4 py-2.5 text-ink hover:text-ink focus:text-ink ${current ? "bg-[#2E8B6A14]" : ""}`}
                            >
                              <AccountGlyph type={account.type} />
                              <span className="min-w-0 flex-1">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="min-w-0 truncate text-body font-medium">{account.name}</span>
                                  {account.estimate ? <span className="shrink-0 rounded bg-line px-1.5 py-0.5 text-meta font-medium text-muted">est.</span> : null}
                                  {account.stale ? <span className="shrink-0 rounded bg-finance-dining/10 px-1.5 py-0.5 text-meta font-medium text-finance-dining">Stale</span> : null}
                                </span>
                                <span className="mt-0.5 block text-meta text-muted">
                                  {sourceLine(account)}
                                  {LOAN_TYPES.has(account.type) && account.balanceAsOf ? ` · as of ${asOfDate(account.balanceAsOf)}` : ""}
                                </span>
                              </span>
                              <span className="shrink-0 text-body font-medium tabular-nums">{money(account.balanceCents)}</span>
                            </Link>
                          </li>
                        );
                      })}
                      {longLoans && expanded ? (
                        <li>
                          <button
                            type="button"
                            data-loans="hide"
                            className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left text-body font-medium text-ink"
                            onClick={() => setOpenGroups((current) => ({ ...current, Loans: false }))}
                          >
                            <span className="min-w-0 flex-1">Hide loans</span>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted" aria-hidden="true">
                              <path d="M6 15l6-6 6 6" />
                            </svg>
                          </button>
                        </li>
                      ) : null}
                    </ul>
                    )}
                  </section>
                  );
                })
              : null}
          </div>
        ) : (
          <div className="px-5 pt-3">
            {statusBanners}
            {notice ? <p role="status" className="mt-3 text-body">{notice}</p> : null}
            {detail}
          </div>
        )}

        {wide ? (
          <aside className="sticky top-2 w-[420px] shrink-0">
            {mode === "add" || mode === "edit" ? (
              <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-2xl">
                <div className="flex items-center gap-1 border-b border-line px-1 py-1">
                  <button type="button" onClick={closeForm} className="inline-flex min-h-11 items-center px-3 text-body text-muted">
                    Cancel
                  </button>
                  <h2 className="min-w-0 flex-1 truncate text-center text-section font-medium">{mode === "edit" ? "Edit account" : "Add account"}</h2>
                  <button type="submit" form={formDomId} disabled={!canSave} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ink px-3 text-body font-medium text-white disabled:opacity-50">
                    Save
                  </button>
                </div>
                <div className="px-5 py-4">{form}</div>
                {mode === "edit" ? (
                  <div className="px-5 pb-4">
                    <button type="button" onClick={() => setConfirming(true)} className="flex min-h-11 w-full items-center text-body text-muted">
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            ) : selected ? (
              <div className="rounded-[20px] border border-line bg-surface p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="min-w-0 truncate text-section font-medium">{selected.name}</h2>
                  {selected.source === "manual" ? (
                    <button type="button" aria-disabled={blocked || undefined} onClick={() => openEdit(selected)} className={`min-h-11 px-3 text-body font-medium ${blocked ? "text-muted opacity-50" : "text-finance-primary"}`}>
                      Edit
                    </button>
                  ) : null}
                </div>
                <div className="mt-3">{detail}</div>
              </div>
            ) : (
              <div className="flex min-h-[520px] items-center justify-center rounded-[20px] border border-line bg-surface p-8">
                <p className="text-body text-muted">Select an account</p>
              </div>
            )}
          </aside>
        ) : null}
      </div>

      {!wide && mode ? (
        <Sheet title={mode === "edit" ? "Edit account" : "Add account"} formId={formDomId} saveDisabled={!canSave} onClose={closeForm} footer={mode === "edit" ? (
          <button type="button" onClick={() => setConfirming(true)} className="flex min-h-11 w-full items-center text-body text-muted">
            Delete
          </button>
        ) : null}>
          {form}
        </Sheet>
      ) : null}

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div ref={confirmRef} role="alertdialog" aria-modal="true" aria-labelledby="delete-account-title" className="w-full max-w-sm rounded-[20px] bg-surface p-5">
            <h2 id="delete-account-title" className="text-section font-medium">
              Delete this account?
            </h2>
            <button type="button" onClick={() => void remove()} className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-finance-dining text-body font-medium text-white">
              Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-[#C9CEC8] bg-surface text-body font-medium">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
