"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  TRANSACTIONS,
  cycleSort,
  filterTransactions,
  formatDay,
  formatLong,
  formatSheetAmount,
  formatTableAmount,
  nextAccount,
  nextAmount,
  nextMonth,
  sortLabel,
  sortTransactions,
  toggleSort,
} from "../../../lib/more-transactions.mjs";

const SEEN = "joehub-more-seen";

type Transaction = {
  id: string;
  date: string;
  merchant: string;
  category: string;
  amount: number;
  currency: string;
  accountAlias: string;
  reviewed: boolean;
};

function initialPhase(view: string) {
  if (view === "loading") return "loading";
  if (view === "empty") return "empty";
  if (view === "error") return "error";
  return "ready";
}

export default function DatabasePage() {
  const params = useSearchParams();
  const view = params.get("view") || "ready";
  const fresh = params.get("fresh") === "1";
  const [phase, setPhase] = useState(initialPhase(view));
  const [settled, setSettled] = useState(false);
  const [sort, setSort] = useState(params.get("sort") || "date-desc");
  const [filters, setFilters] = useState({
    month: params.get("month") || "all",
    amount: params.get("amount") || "all",
    account: params.get("account") || "all",
  });
  const [openId, setOpenId] = useState("");
  const [status, setStatus] = useState("");
  const scroller = useRef<HTMLDivElement | null>(null);
  const retrying = useRef(false);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const pendingFocus = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (view === "error" && !fresh && window.sessionStorage.getItem(SEEN) === "rows") setPhase("stale");
    if (view !== "error" && view !== "loading" && view !== "empty") window.sessionStorage.setItem(SEEN, "rows");
    setSettled(true);
  }, [view, fresh]);

  const source: Transaction[] = phase === "empty" ? [] : TRANSACTIONS;
  const visible: Transaction[] = sortTransactions(filterTransactions(source, filters), sort);
  const filtering = filters.month !== "all" || filters.amount !== "all" || filters.account !== "all";
  const filteredEmpty = (phase === "ready" || phase === "stale") && filtering && visible.length === 0;
  const showTable = (phase === "ready" || phase === "stale" || phase === "loading") && !filteredEmpty;
  const controlsOff = phase === "loading" || phase === "error";
  const open = visible.find((row) => row.id === openId) || null;

  useEffect(() => {
    if (!settled || phase === "loading" || phase === "error" || phase === "empty") return;
    setStatus(`${visible.length} ${visible.length === 1 ? "transaction" : "transactions"}`);
  }, [settled, phase, sort, filters, visible.length]);

  function rememberFocus(id: string) {
    const button = document.getElementById(`tx-${id}`);
    returnFocus.current = button instanceof HTMLButtonElement ? button : null;
    if (!returnFocus.current) return;
    returnFocus.current.dataset.scrollLeft = String(scroller.current?.scrollLeft || 0);
    returnFocus.current.dataset.scrollTop = String(window.scrollY);
  }

  function openRow(id: string) {
    rememberFocus(id);
    setOpenId(id);
  }

  function closeRow() {
    pendingFocus.current = returnFocus.current;
    setOpenId("");
  }

  useEffect(() => {
    if (openId || !pendingFocus.current) return;
    const node = pendingFocus.current;
    pendingFocus.current = null;
    if (scroller.current) scroller.current.scrollLeft = Number(node.dataset.scrollLeft || 0);
    window.scrollTo(0, Number(node.dataset.scrollTop || 0));
    node.focus();
  }, [openId]);

  function retry() {
    if (retrying.current) return;
    retrying.current = true;
    setPhase("loading");
    setStatus("Loading transactions");
    window.setTimeout(() => {
      retrying.current = false;
      window.sessionStorage.setItem(SEEN, "rows");
      setPhase("ready");
    }, 400);
  }

  const state = !settled ? "pending" : filteredEmpty ? "filtered-empty" : phase;

  return (
    <div data-ready={settled ? "true" : "false"} data-state={state} className="min-w-0">
      <div inert={open ? true : undefined}>
        <header className="px-5 pt-3">
          <p className="text-ui-13 text-[#46544B]">
            <Link href="/more#database" className="inline-flex min-h-11 items-center pr-2 font-semibold text-ink">
              ‹ More
            </Link>
            <span aria-hidden="true"> / </span>
            Database
          </p>
          <h1 className="text-ui-22 font-bold">Database</h1>
          <p className="mt-2 text-ui-13 leading-relaxed text-[#46544B]">Transactions · read-only inspection</p>
        </header>
        <div className="mt-4 flex gap-1.5 overflow-hidden px-4">
          <span className="inline-flex min-h-11 items-center rounded-md bg-ink px-2.5 text-ui-12.5 font-medium text-white">Transactions</span>
          <span className="inline-flex min-h-11 items-center rounded-md border border-subtle-border px-2.5 text-ui-12.5 text-muted">Jobs · planned</span>
          <span className="inline-flex min-h-11 items-center rounded-md border border-subtle-border px-2.5 text-ui-12.5 text-muted">Journal · planned</span>
        </div>
        <div className="mt-4 px-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-ui-12 text-[#46544B]">USD · synthetic snapshot</p>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-md border border-subtle-border bg-white px-2.5 text-ui-12.5 font-medium disabled:opacity-50"
              aria-label={`Sort, ${sortLabel(sort)}`}
              disabled={controlsOff}
              onClick={() => setSort((current) => cycleSort(current))}
            >
              {sortLabel(sort)}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <FilterChip
              label={filters.month === "2026-11" ? "Nov 2026" : "Month: all"}
              pressed={filters.month !== "all"}
              removeLabel="Remove November 2026 filter"
              disabled={controlsOff}
              onCycle={() => setFilters((current) => ({ ...current, month: nextMonth(current.month) }))}
              onClear={() => setFilters((current) => ({ ...current, month: "all" }))}
            />
            <FilterChip
              label={filters.amount === "income" ? "Income only" : filters.amount === "expense" ? "Expenses only" : "All amounts"}
              pressed={filters.amount !== "all"}
              removeLabel="Remove amount filter"
              disabled={controlsOff}
              onCycle={() => setFilters((current) => ({ ...current, amount: nextAmount(current.amount) }))}
              onClear={() => setFilters((current) => ({ ...current, amount: "all" }))}
            />
          </div>
          <div className="mt-2">
            <FilterChip
              label={filters.account === "all" ? "Account: all" : filters.account}
              pressed={filters.account !== "all"}
              removeLabel="Remove account filter"
              disabled={controlsOff}
              onCycle={() => setFilters((current) => ({ ...current, account: nextAccount(current.account) }))}
              onClear={() => setFilters((current) => ({ ...current, account: "all" }))}
            />
          </div>
        </div>
        <p id="table-hint" className="mx-4 mt-2.5 text-ui-12 leading-relaxed text-[#46544B]">
          Swipe horizontally for more columns.
          <br />
          Merchant stays pinned. Tap a row for details.
        </p>
        <p className="sr-only" role="status">
          {phase === "loading" ? "Loading transactions" : status}
        </p>
        {phase === "stale" ? (
          <p className="mx-4 mt-3 rounded-xl border border-subtle-border bg-white p-3 text-ui-13 leading-relaxed" role="status">
            Couldn’t refresh this table. Showing the last snapshot. Saved data was not changed.
            <button type="button" className="mt-2 flex min-h-11 items-center font-semibold" onClick={retry}>
              Retry
            </button>
          </p>
        ) : null}
        {showTable ? (
          <div className="mx-4 mt-3 overflow-hidden rounded-md border border-subtle-border bg-white">
            <div
              id="table-scroll"
              ref={scroller}
              tabIndex={0}
              role="region"
              aria-label="Scrollable transactions table"
              aria-describedby="table-hint"
              aria-busy={phase === "loading" ? "true" : undefined}
              className="overflow-x-auto"
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                event.currentTarget.scrollLeft += event.key === "ArrowRight" ? 48 : -48;
              }}
            >
              <table className="w-[568px] table-fixed border-separate border-spacing-0 text-left text-ui-12.5">
                <caption className="sr-only">Transactions, amounts in USD. Synthetic examples, read only.</caption>
                <colgroup>
                  <col className="w-[128px]" />
                  <col className="w-[76px]" />
                  <col className="w-[112px]" />
                  <col className="w-[100px]" />
                  <col className="w-[96px]" />
                  <col className="w-[56px]" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" className="sticky left-0 z-[3] h-11 border-b border-r border-line bg-table-header px-2.5 font-semibold shadow-[1px_0_0_#C9CEC8]">
                      Merchant
                    </th>
                    <SortHeader label="Date" column="date" sort={sort} disabled={controlsOff} onSort={setSort} />
                    <th scope="col" className="h-11 border-b border-r border-line bg-table-header px-2.5 font-semibold">
                      Category
                    </th>
                    <SortHeader label="Amount" column="amount" sort={sort} disabled={controlsOff} onSort={setSort} align="right" />
                    <th scope="col" className="h-11 border-b border-r border-line bg-table-header px-2.5 font-semibold">
                      Account
                    </th>
                    <th scope="col" className="h-11 border-b border-line bg-table-header px-2.5 font-semibold">
                      <abbr title="Reviewed">Rev.</abbr>
                    </th>
                  </tr>
                </thead>
                {phase === "loading" ? (
                  <tbody aria-hidden="true">
                    {Array.from({ length: 6 }, (_, index) => (
                      <tr key={index}>
                        {Array.from({ length: 6 }, (__, cell) => (
                          <td key={cell} className="h-11 border-b border-r border-line px-2.5 last:border-r-0">
                            <span className="block h-3 w-4/5 rounded bg-line" />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                ) : (
                  <tbody>
                    {visible.map((row) => (
                      <tr
                        key={row.id}
                        className={openId === row.id ? "bg-[#F0F5F2]" : undefined}
                        onClick={(event) => {
                          if (event.target instanceof Element && event.target.closest("button")) return;
                          openRow(row.id);
                        }}
                      >
                        <th scope="row" className={`sticky left-0 z-[2] h-11 border-b border-r border-line px-2.5 text-left font-medium shadow-[1px_0_0_#C9CEC8] ${openId === row.id ? "bg-[#F0F5F2]" : "bg-white"}`}>
                          <button
                            id={`tx-${row.id}`}
                            type="button"
                            className="block h-11 max-w-[108px] truncate text-left font-medium"
                            aria-label={`Open transaction ${row.merchant}, ${formatDay(row.date)}, ${formatTableAmount(row.amount)} USD`}
                            onClick={() => openRow(row.id)}
                          >
                            {row.merchant}
                          </button>
                        </th>
                        <td className="h-11 whitespace-nowrap border-b border-r border-line px-2.5">{formatDay(row.date)}</td>
                        <td className="h-11 whitespace-nowrap border-b border-r border-line px-2.5">{row.category}</td>
                        <td className={`h-11 whitespace-nowrap border-b border-r border-line px-2.5 text-right tabular-nums ${row.amount > 0 ? "text-[#246C53]" : ""}`}>
                          {formatTableAmount(row.amount)}
                        </td>
                        <td className="h-11 whitespace-nowrap border-b border-r border-line px-2.5">{row.accountAlias}</td>
                        <td className="h-11 border-b border-line px-2.5">{row.reviewed ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                )}
              </table>
            </div>
          </div>
        ) : null}
        {phase === "loading" ? <p className="mx-4 mt-3 text-ui-14 leading-relaxed">Loading your table. No counts until it resolves.</p> : null}
        {phase === "empty" ? (
          <StateCard title="No transactions yet" body="Your table is ready for its first transaction. No example balances or zero totals have been inferred.">
            <Link href="/more#database" className="mt-4 flex min-h-12 items-center justify-center rounded-2xl bg-ink px-4 text-ui-16 font-bold text-white">
              Back to More
            </Link>
          </StateCard>
        ) : null}
        {phase === "error" ? (
          <StateCard title="Table unavailable" body="We couldn’t load transactions. Your saved data hasn’t been changed.">
            <button type="button" className="mt-4 flex min-h-12 w-full items-center justify-center rounded-2xl bg-ink px-4 text-ui-16 font-bold text-white" onClick={retry}>
              Retry
            </button>
            <Link href="/more#database" className="mt-3 flex min-h-12 items-center justify-center rounded-2xl border border-ink bg-white px-4 text-ui-16 font-bold">
              Back to More
            </Link>
          </StateCard>
        ) : null}
        {filteredEmpty ? (
          <StateCard title="No matching transactions" body={`No rows match ${filterSentence(filters)}. Your other transactions are still in the table.`}>
            <button
              type="button"
              className="mt-4 flex min-h-12 w-full items-center justify-center rounded-2xl bg-ink px-4 text-ui-16 font-bold text-white"
              onClick={() => {
                setFilters({ month: "all", amount: "all", account: "all" });
                document.getElementById("filter-month")?.focus();
              }}
            >
              Clear filters
            </button>
            <Link href="/more#database" className="mt-3 flex min-h-12 items-center justify-center rounded-2xl border border-ink bg-white px-4 text-ui-16 font-bold">
              Back to More
            </Link>
          </StateCard>
        ) : null}
        {showTable && phase !== "loading" ? (
          <p className="mx-4 mt-2.5 text-ui-12 leading-relaxed text-[#46544B]">
            {visible.length} example {visible.length === 1 ? "row" : "rows"} · {filtering ? "filtered results" : "all rows in this snapshot"}
            <br />
            Read-only · no inline editing or account linking
          </p>
        ) : null}
      </div>
      {open ? <Detail row={open} onClose={closeRow} /> : null}
    </div>
  );
}

function filterSentence(filters: { month: string; amount: string; account: string }) {
  const parts = [];
  if (filters.month === "2026-11") parts.push("Nov 2026");
  if (filters.amount === "expense") parts.push("Expenses only");
  if (filters.amount === "income") parts.push("Income only");
  if (filters.account !== "all") parts.push(filters.account);
  if (parts.length < 2) return parts[0] || "these filters";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function FilterChip({
  label,
  pressed,
  removeLabel,
  disabled,
  onCycle,
  onClear,
}: {
  label: string;
  pressed: boolean;
  removeLabel: string;
  disabled: boolean;
  onCycle: () => void;
  onClear: () => void;
}) {
  const cycleRef = useRef<HTMLButtonElement | null>(null);
  return (
    <span className={`inline-flex items-center rounded-md border border-subtle-border ${pressed ? "bg-table-header" : "bg-white"}`}>
      <button
        id={label.startsWith("Month") || label === "Nov 2026" ? "filter-month" : undefined}
        ref={cycleRef}
        type="button"
        className="inline-flex min-h-11 items-center px-2.5 text-ui-12.5 font-medium disabled:opacity-50"
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onCycle}
      >
        {label}
      </button>
      {pressed ? (
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center text-ui-18 disabled:opacity-50"
          aria-label={removeLabel}
          disabled={disabled}
          onClick={() => {
            onClear();
            cycleRef.current?.focus();
          }}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

function SortHeader({
  label,
  column,
  sort,
  disabled,
  onSort,
  align = "left",
}: {
  label: string;
  column: "date" | "amount";
  sort: string;
  disabled: boolean;
  onSort: (next: string) => void;
  align?: "left" | "right";
}) {
  const active = sort.startsWith(column);
  const direction = sort.endsWith("asc") ? "ascending" : "descending";
  return (
    <th scope="col" aria-sort={active ? direction : undefined} className="h-11 border-b border-r border-line bg-table-header px-2.5 font-semibold">
      <button
        type="button"
        className={`inline-flex h-11 items-center gap-1 font-semibold disabled:opacity-50 ${align === "right" ? "w-full justify-end" : ""}`}
        disabled={disabled}
        aria-label={`Sort ${label}`}
        onClick={() => onSort(toggleSort(sort, column))}
      >
        {label}
        {active ? (direction === "ascending" ? " ↑" : " ↓") : null}
      </button>
    </th>
  );
}

function StateCard({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <section className="card mx-4 mt-4 p-4">
      <h2 className="text-ui-22 font-bold">{title}</h2>
      <p className="mt-2.5 text-ui-14 leading-relaxed">{body}</p>
      {children}
    </section>
  );
}

function Detail({ row, onClose }: { row: Transaction; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const node = ref.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      [...(node?.querySelectorAll<HTMLElement>("button, a[href]") ?? [])].filter((el) => !el.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <div className="absolute inset-0 bg-ink/45" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 max-h-[85vh] w-full max-w-phone overflow-y-auto rounded-t-sheetTop bg-white px-5 pb-6 pt-3"
      >
        <div className="mx-auto mb-3 h-[5px] w-10 rounded-full bg-support-handle" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3">
          <p className="text-ui-13 text-[#46544B]">Transaction · read-only</p>
          <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-subtle-border text-ui-22" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <h2 id={titleId} className="mt-2 text-ui-22 font-bold">
          {row.merchant}
        </h2>
        <p className={`text-ui-40 font-bold tabular-nums ${row.amount > 0 ? "text-[#246C53]" : ""}`}>{formatSheetAmount(row.amount)}</p>
        <p className="text-ui-13 text-[#46544B]">{formatLong(row.date)} · Synthetic example</p>
        <dl className="mt-4">
          {[
            ["Category", row.category],
            ["Account", row.accountAlias],
            ["Reviewed", row.reviewed ? "Yes" : "No"],
            ["Currency", row.currency],
          ].map(([term, value]) => (
            <div key={term} className="flex items-center justify-between gap-4 border-t border-line py-3 text-ui-14">
              <dt className="text-muted">{term}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 rounded-xl bg-page p-3 text-ui-12 leading-relaxed">Inspection only. No inline edits, review toggle, financial action or account credentials.</p>
        <button type="button" className="mt-4 flex min-h-12 w-full items-center justify-center rounded-2xl bg-ink text-ui-16 font-bold text-white" onClick={onClose}>
          Back to table
        </button>
      </div>
    </div>
  );
}
