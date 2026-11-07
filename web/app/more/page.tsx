"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import { transactions } from "../../lib/design-fixtures";

const sets = ["Transactions", "Jobs", "Journal", "Dates", "Goals"] as const;

export default function MorePage() {
  const [setName, setSetName] = useState<(typeof sets)[number]>("Transactions");
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState(true);
  const [outflow, setOutflow] = useState(false);
  const [ascending, setAscending] = useState(false);
  const [darkFinance, setDarkFinance] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setDarkFinance(localStorage.getItem("joehub-finance-theme") === "dark");
  }, []);

  const rows = useMemo(() => {
    const order = (date: string) => {
      const [monthName, day] = date.split(" ");
      const months: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
      return (months[monthName] ?? 0) * 100 + Number(day);
    };
    const filtered = transactions.filter((row) => {
      const haystack = row.join(" ").toLowerCase();
      if (query && !haystack.includes(query.toLowerCase())) return false;
      if (month && !row[1].startsWith("Nov") && !row[1].startsWith("Oct")) return false;
      if (outflow && row[3].startsWith("+")) return false;
      return true;
    });
    return filtered.sort((left, right) => (ascending ? order(left[1]) - order(right[1]) : order(right[1]) - order(left[1])));
  }, [query, month, outflow, ascending]);

  return (
    <div className="space-y-4 px-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Database · {setName}</h1>
        <button
          type="button"
          className="grid h-10 w-10 place-items-center rounded-full bg-surface"
          aria-pressed={darkFinance}
          aria-label="Use dark appearance on Finance home"
          onClick={() => {
            const next = !darkFinance;
            setDarkFinance(next);
            localStorage.setItem("joehub-finance-theme", next ? "dark" : "light");
            window.dispatchEvent(new Event("joehub-theme"));
            setNotice(
              next
                ? "Finance home will use the dark frame. This page stays light."
                : "Finance home will use the light frame.",
            );
          }}
        >
          <Icon name="sun" />
        </button>
      </header>
      <div role="tablist" aria-label="Record set" className="flex gap-2 overflow-x-auto">
        {sets.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={setName === name}
            onClick={() => setSetName(name)}
            className={`shrink-0 rounded-full px-3 py-1 text-sm ${
              setName === name ? "bg-ink text-white" : "bg-surface text-ink"
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      {setName === "Transactions" ? (
        <>
          <label className="sr-only" htmlFor="row-search">
            Search transactions
          </label>
          <input
            id="row-search"
            className="w-full rounded-xl border border-line bg-surface px-3 py-2"
            placeholder="Search 412 rows"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={month} className="rounded-full border border-line px-3 py-1 text-sm" onClick={() => setMonth((value) => !value)}>
              Month: Nov+Oct {month ? "×" : ""}
            </button>
            <button
              type="button"
              aria-pressed={outflow}
              className="rounded-full border border-line px-3 py-1 text-sm"
              onClick={() => setOutflow((value) => !value)}
            >
              Amount &lt; 0 {outflow ? "×" : ""}
            </button>
            <button type="button" className="rounded-full border border-dashed border-line px-3 py-1 text-sm" onClick={() => setNotice("No other filters were designed.")}>
              Add filter
            </button>
            <button type="button" className="rounded-full border border-line px-3 py-1 text-sm" onClick={() => setAscending((value) => !value)} aria-pressed={ascending}>
              Date {ascending ? "↑" : "↓"}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Example transactions from the frame. Not live records.</caption>
              <thead className="bg-table-header">
                <tr>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Merchant
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Category
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.join("-")} className="border-b border-line">
                    <th scope="row" className="px-2 py-2 font-normal">
                      {row[0]}
                    </th>
                    <td className="px-2 py-2">{row[1]}</td>
                    <td className="px-2 py-2">{row[2]}</td>
                    <td className={`px-2 py-2 text-right ${row[3].startsWith("+") ? "text-finance-primary" : ""}`}>{row[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">The frame shows these columns first. Editing a cell is not designed.</p>
        </>
      ) : (
        <p className="card p-4 text-sm text-muted">
          {setName} has no table frame. The transactions table is the only designed More screen.
        </p>
      )}
      {notice ? (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
