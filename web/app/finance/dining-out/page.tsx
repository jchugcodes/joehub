"use client";

import { useState } from "react";
import { FinanceTabs } from "../../../components/FinanceTabs";
import { Sheet } from "../../../components/Sheet";
import { categories } from "../../../lib/design-fixtures";

export default function DiningOutPage() {
  const [open, setOpen] = useState(true);
  const [choice, setChoice] = useState("Groceries");
  const [always, setAlways] = useState(true);
  const [cap, setCap] = useState("80");
  const [saved, setSaved] = useState("");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Finance</p>
      <h1 className="text-3xl font-semibold">Dining Out</h1>
      <FinanceTabs />
      <section className="rounded-2xl bg-card p-4 shadow-sm">
        <p className="text-2xl font-semibold">
          $62 <span className="text-base font-normal text-muted">of $80 this week</span>
        </p>
        <button type="button" className="mt-4 text-sm font-semibold text-finance-text" onClick={() => setOpen(true)}>
          Recategorize a charge
        </button>
      </section>
      {open ? (
        <Sheet title="Recategorize" onClose={() => setOpen(false)}>
            <p className="font-medium">Sweetgreen</p>
            <p className="text-sm text-muted">Wed Nov 4 · −$16.25</p>
            <fieldset className="mt-4">
              <legend className="text-sm text-muted">Move to</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {categories.map((category) => (
                  <label key={category} className="cursor-pointer">
                    <input
                      className="sr-only"
                      type="radio"
                      name="category"
                      value={category}
                      checked={choice === category}
                      onChange={() => setChoice(category)}
                    />
                    <span
                      className={`inline-block rounded-full border px-3 py-1 text-sm ${
                        choice === category ? "border-finance-text bg-finance-text text-white" : "border-line"
                      }`}
                    >
                      {category}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">Always for &quot;Sweetgreen&quot;</p>
                <p className="text-sm text-muted">Create a rule for future charges</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={always}
                onClick={() => setAlways((value) => !value)}
                className={`h-7 w-12 rounded-full p-1 ${always ? "bg-finance-text" : "bg-line"}`}
              >
                <span className={`block h-5 w-5 rounded-full bg-white ${always ? "ml-auto" : ""}`} />
                <span className="sr-only">{always ? "Rule on" : "Rule off"}</span>
              </button>
            </div>
            <label className="mt-4 block text-sm font-medium" htmlFor="weekly-cap">
              Weekly cap — Dining Out
            </label>
            <input
              id="weekly-cap"
              inputMode="decimal"
              className="mt-1 w-full rounded-xl border border-line bg-canvas px-3 py-2"
              value={cap}
              onChange={(event) => setCap(event.target.value)}
            />
            <button
              type="button"
              className="mt-4 w-full rounded-full bg-finance-text py-3 font-semibold text-white"
              onClick={() => {
                setSaved(`Saved locally: ${choice}, cap $${cap}. Not sent to the API.`);
                setOpen(false);
              }}
            >
              Save
            </button>
            <p className="mt-2 text-center text-xs tracking-wide text-muted">EXAMPLE DATA</p>
        </Sheet>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-muted">
          {saved}
        </p>
      ) : null}
    </div>
  );
}
