"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CategoryMark } from "./CategoryMark";
import { FinanceTabs } from "./FinanceTabs";
import { Sheet } from "./Sheet";

type Payment = { id: string; amountCents: number; accountName: string; label: string };
type Bill = {
  id: string;
  name: string;
  amountCents: number;
  dueDate: string;
  recurrence: "monthly" | "weekly" | "yearly";
  category: string | null;
  categoryName: string;
  accountId: string;
  accountName: string;
  paid: boolean;
  group: string;
  dueLabel: string;
  payments: Payment[];
};
type AccountOption = { id: string; name: string };
type Snapshot = { updatedAt: string | null; empty?: boolean; today?: string; bills: Bill[]; accounts: AccountOption[] };

const GROUPS = ["Overdue", "This week", "Later"];
const REPEATS = [
  { id: "monthly", name: "Monthly" },
  { id: "weekly", name: "Weekly" },
  { id: "yearly", name: "Yearly" },
] as const;
const CATEGORIES = [
  { slug: "dining-out", name: "Dining Out" },
  { slug: "groceries", name: "Groceries" },
  { slug: "transport", name: "Transport" },
  { slug: "subscriptions", name: "Subscriptions" },
  { slug: "shopping", name: "Shopping" },
  { slug: "utilities", name: "Utilities" },
  { slug: "", name: "Uncategorized" },
];

function money(cents: number) {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
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
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000_000) return null;
  return cents;
}

function PaidSwitch({ on, muted, onToggle }: { on: boolean; muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Paid"
      aria-disabled={muted || undefined}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={`inline-flex min-h-11 min-w-11 items-center justify-end ${muted ? "opacity-40" : ""}`}
    >
      <span className={`relative h-[31px] w-[51px] rounded-full ${on ? "bg-[#2E8B6A]" : "bg-[#C9CEC8]"}`}>
        <span className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow ${on ? "left-[22px]" : "left-[2px]"}`} />
      </span>
    </button>
  );
}

export function FinanceBills({ selectedId = "" }: { selectedId?: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const asOf = search.get("asOf") || "";
  const previewEmpty = search.get("view") === "empty";
  const previewLink = search.get("link") || "";
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [wide, setWide] = useState(false);
  const [tone, setTone] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"" | "add" | "edit">("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [recurrence, setRecurrence] = useState<(typeof REPEATS)[number]["id"]>("monthly");
  const [category, setCategory] = useState("utilities");
  const [accountId, setAccountId] = useState("acct-checking");
  const idem = useRef("");
  const savingRef = useRef(false);
  const backTimer = useRef<number | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const blocked = tone === "offline" || tone === "reconnecting" || previewLink === "offline" || previewLink === "reconnecting";

  const query = new URLSearchParams();
  if (asOf) query.set("asOf", asOf);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const listHref = `/finance/bills${suffix}`;

  const load = useCallback(async () => {
    const listed = await fetch(`/api/finance/bills${suffix}`, { cache: "no-store" });
    if (!listed.ok) throw new Error("bills");
    const body = (await listed.json()) as Snapshot;
    setSnapshot(body);
    return body;
  }, [suffix]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const apply = () => setWide(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    let gone = false;
    void load().catch(() => {
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

  const bills = snapshot?.bills ?? [];
  const accounts = snapshot?.accounts?.length ? snapshot.accounts : [{ id: "acct-checking", name: "Everyday checking" }];
  const selected = bills.find((bill) => bill.id === selectedId) || null;
  const empty = previewEmpty || Boolean(snapshot && (snapshot.empty || bills.length === 0));
  const shownTone = previewLink || tone;
  const amountOk = centsFromInput(amount) != null;
  const canSave = name.trim().length > 0 && amountOk && !saving && !blocked;

  function clockQuery(path: string) {
    if (!asOf) return path;
    return `${path}${path.includes("?") ? "&" : "?"}asOf=${encodeURIComponent(asOf)}`;
  }

  function openAdd() {
    if (blocked) {
      setNotice("Can’t edit offline");
      return;
    }
    idem.current = crypto.randomUUID();
    setName("");
    setAmount("");
    setDue("");
    setRecurrence("monthly");
    setCategory("utilities");
    setAccountId(accounts[0]?.id || "acct-checking");
    setError("");
    setConfirming(false);
    setMode("add");
  }

  function openEdit(bill: Bill) {
    if (blocked) {
      setNotice("Can’t edit offline");
      return;
    }
    setName(bill.name);
    setAmount(money(bill.amountCents));
    setDue(bill.dueDate);
    setRecurrence(bill.recurrence);
    setCategory(bill.category || "");
    setAccountId(bill.accountId);
    setError("");
    setConfirming(false);
    setMode("edit");
  }

  function closeForm() {
    setMode("");
    setError("");
    setConfirming(false);
  }

  async function togglePaid(bill: Bill) {
    if (blocked) {
      setNotice("Can’t edit offline");
      return;
    }
    setNotice("");
    const response = await fetch(clockQuery(`/api/finance/bills/${bill.id}`), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paid: !bill.paid }),
    });
    if (!response.ok) {
      const failed = (await response.json().catch(() => null)) as { detail?: string } | null;
      setNotice(failed?.detail || "Couldn’t update that bill.");
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
    const cents = centsFromInput(amount);
    if (cents == null) {
      setError("Enter a valid amount.");
      return;
    }
    const dueDate = due || snapshot?.today || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      setError("Enter a valid date.");
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    const editing = mode === "edit" && selected;
    const body = {
      name: name.trim(),
      amountCents: cents,
      dueDate,
      recurrence,
      category: category || null,
      accountId,
    };
    const response = await fetch(clockQuery(editing ? `/api/finance/bills/${selected.id}` : "/api/finance/bills"), {
      method: editing ? "PATCH" : "POST",
      headers: { "content-type": "application/json", ...(editing ? {} : { "idempotency-key": idem.current }) },
      body: JSON.stringify(body),
    });
    savingRef.current = false;
    setSaving(false);
    if (!response.ok) {
      const failed = (await response.json().catch(() => null)) as { detail?: string } | null;
      setError(failed?.detail || "Couldn’t save that bill.");
      return;
    }
    const saved = (await response.json()) as Bill;
    closeForm();
    if (!editing) router.push(`/finance/bills/${saved.id}${suffix}`);
    await load();
  }

  async function remove() {
    if (!selected) return;
    if (blocked) {
      setNotice("Can’t edit offline");
      setConfirming(false);
      return;
    }
    const response = await fetch(clockQuery(`/api/finance/bills/${selected.id}`), { method: "DELETE" });
    if (!response.ok) {
      const failed = (await response.json().catch(() => null)) as { detail?: string } | null;
      setNotice(failed?.detail || "Couldn’t delete that bill.");
      setConfirming(false);
      return;
    }
    setConfirming(false);
    closeForm();
    router.push(listHref);
    await load();
  }

  const form = (
    <form id="bill-form" onSubmit={(event) => void save(event)}>
      <label className="mb-4 block">
        <span className="mb-1.5 block text-body">Name</span>
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
          onFocus={() => {
            setError((current) => (current === "Name required." ? "" : current));
          }}
          onBlur={() => {
            if (!name.trim()) setError("Name required.");
          }}
          placeholder="Bill name"
          aria-label="Name"
          enterKeyHint="next"
          autoComplete="off"
          data-autofocus="true"
          className="h-[52px] w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink outline-none focus:border-2 focus:border-ink"
        />
      </label>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <label className="min-w-0">
          <span className="mb-1.5 block text-body">Amount</span>
          <input
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setError("");
            }}
            onBlur={() => {
              if (centsFromInput(amount) == null) setError("Enter a valid amount.");
            }}
            placeholder="$0.00"
            inputMode="decimal"
            enterKeyHint="next"
            className="h-[52px] w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink outline-none focus:border-2 focus:border-ink"
          />
        </label>
        <label className="min-w-0">
          <span className="mb-1.5 block text-body">Due</span>
          <input
            type="date"
            value={due}
            onChange={(event) => setDue(event.target.value)}
            enterKeyHint="done"
            className="h-[52px] w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink outline-none focus:border-2 focus:border-ink"
          />
        </label>
      </div>
      <p className="mb-2 text-body">Repeats</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {REPEATS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={recurrence === item.id}
            onClick={() => setRecurrence(item.id)}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-body font-medium ${recurrence === item.id ? "border-ink bg-ink text-white" : "border-line text-muted"}`}
          >
            {item.name}
          </button>
        ))}
      </div>
      <p className="mb-2 text-body">Category</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {CATEGORIES.map((item) => (
          <button
            key={item.name}
            type="button"
            aria-pressed={category === item.slug}
            onClick={() => setCategory(item.slug)}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-body font-medium ${category === item.slug ? "border-ink bg-ink text-white" : "border-line text-muted"}`}
          >
            {item.name}
          </button>
        ))}
      </div>
      <p className="mb-2 text-body">Paid from</p>
      <div className="flex flex-wrap gap-2">
        {accounts.map((account) => (
          <button
            key={account.id}
            type="button"
            aria-pressed={accountId === account.id}
            onClick={() => setAccountId(account.id)}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-body font-medium ${accountId === account.id ? "border-ink bg-ink text-white" : "border-line text-muted"}`}
          >
            {account.name}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-body text-finance-dining">
          {error}
        </p>
      ) : null}
    </form>
  );

  const detail = selected ? (
    <div className="min-w-0">
      <p className={`text-title font-medium tabular-nums ${selected.group === "Overdue" ? "text-finance-dining" : ""}`}>{money(selected.amountCents)}</p>
      <p className={`mt-1 text-meta ${selected.group === "Overdue" ? "text-finance-dining" : "text-muted"}`}>{selected.dueLabel}</p>
      <p className="mt-1 text-meta text-muted">
        {selected.categoryName} · {selected.accountName}
      </p>
      <div className="mt-4 flex min-h-14 items-center justify-between gap-3 rounded-[20px] border border-line bg-surface px-4">
        <span className="text-body font-medium">Paid</span>
        <PaidSwitch on={selected.paid} muted={blocked} onToggle={() => void togglePaid(selected)} />
      </div>
      {selected.payments.length ? (
        <>
          <h2 className="mt-5 text-section font-medium">Recent payments</h2>
          <ul>
            {selected.payments.map((payment) => (
              <li key={payment.id} className="flex items-center gap-3 py-2.5">
                <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#2E8B6A1F] text-[#2E8B6A]">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="6" width="18" height="14" rx="2" />
                    <path d="M16 13h2M3 10h18M6 6V4h11v2" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium">{payment.accountName}</span>
                  <span className="mt-0.5 block text-meta text-muted">{payment.label}</span>
                </span>
                <span className="shrink-0 text-body font-medium tabular-nums">{money(payment.amountCents)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  ) : null;

  const deleteButton = (
    <button type="button" onClick={() => setConfirming(true)} className="flex min-h-11 w-full items-center text-body text-muted">
      Delete
    </button>
  );

  return (
    <main className="finance-type min-w-0 text-ink" data-ready={snapshot ? "true" : undefined} data-bills={empty ? "empty" : "list"}>
      {shownTone === "offline" && snapshot?.updatedAt ? (
        <p role="status" data-offline="true" data-link="offline" className="mx-4 mt-3 rounded-2xl border border-[#C9CEC8] bg-[#EEF0EC] px-3.5 py-3">
          <span className="block text-body font-medium">Offline</span>
          <span className="mt-0.5 block text-meta text-muted">Last updated {stamp(snapshot.updatedAt)} America/Detroit</span>
        </p>
      ) : null}
      {shownTone === "reconnecting" ? (
        <p role="status" data-offline="true" data-link="reconnecting" className="mx-4 mt-3 rounded-2xl border border-[#E9B94933] bg-[#E9B9491F] px-3.5 py-3 text-body font-medium text-[#8A6B14]">
          Reconnecting…
        </p>
      ) : null}
      {shownTone === "back" ? (
        <p role="status" data-link="back" className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[#2E8B6A33] bg-[#2E8B6A1F] px-3.5 py-3 text-body font-medium text-[#246C53]">
          <span>Back online</span>
          <button type="button" className="min-h-11 px-2 text-meta font-medium text-muted" onClick={() => setTone("")}>
            Dismiss
          </button>
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mx-4 mt-3 text-body">
          {notice}
        </p>
      ) : null}

      {wide || !selected ? (
        <>
          <header className="flex items-center justify-between px-5 pt-2">
            <div>
              <p className="text-meta text-muted">joehub</p>
              <h1 className="text-title font-medium">Bills</h1>
            </div>
            <button type="button" aria-label="Add a bill" onClick={openAdd} className={`min-h-11 min-w-11 px-2 text-body font-medium text-finance-primary ${blocked ? "opacity-40" : ""}`}>
              Add
            </button>
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
          <button type="button" onClick={() => openEdit(selected)} className={`min-h-11 px-3 text-body font-medium text-finance-primary ${blocked ? "opacity-40" : ""}`}>
            Edit
          </button>
        </header>
      )}

      <div className={wide ? "mt-3 flex min-w-0 items-start gap-4 px-4" : ""}>
        {wide || !selected ? (
          <div className="min-w-0 flex-1">
            {!snapshot ? <p className="px-5 py-8 text-body text-muted">Loading bills…</p> : null}
            {snapshot && empty ? (
              <div className="px-5 py-16 text-center">
                <p className="text-section font-medium">No upcoming bills</p>
                <button type="button" onClick={openAdd} className="mx-auto mt-5 inline-flex min-h-12 min-w-[200px] items-center justify-center rounded-xl bg-ink px-4 text-body font-medium text-white">
                  Add a bill
                </button>
              </div>
            ) : null}
            {snapshot && !empty
              ? GROUPS.map((group) => {
                  const rows = bills.filter((bill) => bill.group === group);
                  if (!rows.length) return null;
                  return (
                    <section key={group}>
                      <h2 className={`${wide ? "px-1" : "px-5"} pt-5 text-section font-medium`}>{group}</h2>
                      <ul className={`${wide ? "" : "mx-4"} mt-2 divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-surface`}>
                        {rows.map((bill) => (
                          <li key={bill.id} className="flex min-h-16 items-center gap-3 px-4 py-2.5">
                            <Link href={`/finance/bills/${bill.id}${suffix}`} className="flex min-w-0 flex-1 items-center gap-3">
                              <CategoryMark category={bill.category} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-body font-medium">{bill.name}</span>
                                <span className={`mt-0.5 block text-meta ${bill.group === "Overdue" ? "text-finance-dining" : "text-muted"}`}>{bill.dueLabel}</span>
                              </span>
                            </Link>
                            <span className="flex shrink-0 flex-col items-end gap-1.5">
                              <span className={`text-body font-medium tabular-nums ${bill.group === "Overdue" ? "text-finance-dining" : ""}`}>{money(bill.amountCents)}</span>
                              <PaidSwitch on={bill.paid} muted={blocked} onToggle={() => void togglePaid(bill)} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })
              : null}
          </div>
        ) : (
          <div className="px-5 pt-3">{detail}</div>
        )}

        {wide ? (
          <aside className="sticky top-2 w-[420px] shrink-0">
            {mode === "add" || (mode === "edit" && selected) ? (
              <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-2xl">
                <div className="flex items-center gap-1 border-b border-line px-1 py-1">
                  <button type="button" onClick={closeForm} className="inline-flex min-h-11 items-center px-3 text-body text-muted">
                    Cancel
                  </button>
                  <h2 className="min-w-0 flex-1 truncate text-center text-section font-medium">{mode === "edit" ? "Edit bill" : "Add a bill"}</h2>
                  <button type="submit" form="bill-form" disabled={!canSave} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ink px-3 text-body font-medium text-white disabled:opacity-50">
                    Save
                  </button>
                </div>
                <div className="px-5 py-4">{form}</div>
                {mode === "edit" ? <div className="px-5 pb-4">{deleteButton}</div> : null}
              </div>
            ) : selected ? (
              <div className="rounded-[20px] border border-line bg-surface p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="min-w-0 truncate text-section font-medium">{selected.name}</h2>
                  <button type="button" onClick={() => openEdit(selected)} className={`min-h-11 px-3 text-body font-medium text-finance-primary ${blocked ? "opacity-40" : ""}`}>
                    Edit
                  </button>
                </div>
                <div className="mt-3">{detail}</div>
              </div>
            ) : (
              <div className="flex min-h-[520px] items-center justify-center rounded-[20px] border border-line bg-surface p-8">
                <p className="text-body text-muted">Select a bill</p>
              </div>
            )}
          </aside>
        ) : null}
      </div>

      {!wide && mode ? (
        <Sheet
          title={mode === "edit" ? "Edit bill" : "Add a bill"}
          formId="bill-form"
          saveDisabled={!canSave}
          onClose={closeForm}
          footer={mode === "edit" ? deleteButton : null}
        >
          {form}
        </Sheet>
      ) : null}

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div ref={confirmRef} role="alertdialog" aria-modal="true" aria-labelledby="delete-bill-title" className="w-full max-w-sm rounded-[20px] bg-surface p-5">
            <h2 id="delete-bill-title" className="text-section font-medium">
              Delete this bill?
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
