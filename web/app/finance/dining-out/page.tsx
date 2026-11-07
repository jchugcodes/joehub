"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "../../../components/Icon";
import { Sheet } from "../../../components/Sheet";
import { categories } from "../../../lib/design-fixtures";

const weeks = [
  { label: "W1", height: 46.2, color: "bg-support-softGreen" },
  { label: "W2", height: 74.8, color: "bg-support-softGreen" },
  { label: "W3", height: 60.5, color: "bg-support-softGreen" },
  { label: "W4", height: 88, color: "bg-finance-dining" },
  { label: "W5", height: 33, color: "bg-support-softGreen" },
  { label: "W6", height: 81.4, color: "bg-support-softGreen" },
  { label: "Now", height: 68.2, color: "bg-finance-primary" },
];

const chipIcon: Record<string, string> = {
  "Dining Out": "dining",
  Groceries: "groceries",
  Transport: "transport",
  Subscriptions: "subscriptions",
  Shopping: "shopping",
  Utilities: "utilities",
};

const chipColor: Record<string, string> = {
  "Dining Out": "text-finance-dining",
  Groceries: "text-finance-primary",
  Transport: "text-finance-transport",
  Subscriptions: "text-finance-subscriptions",
  Shopping: "text-finance-shopping",
  Utilities: "text-finance-utilities",
};

export default function DiningOutPage() {
  const [open, setOpen] = useState(true);
  const [choice, setChoice] = useState("Groceries");
  const [always, setAlways] = useState(true);
  const [demo, setDemo] = useState("");

  return (
    <div>
      <div className="flex items-center justify-between px-4 pt-2">
        <Link href="/finance" aria-label="Back to Finance" className="text-ink">
          <Icon name="back" size={24} />
        </Link>
        <h1 className="text-ui-16 font-bold">Dining Out</h1>
        <button type="button" className="text-ink" aria-label="Edit category" onClick={() => setDemo("Demo only. Nothing was saved.")}>
          <Icon name="pencil" size={20} />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-3 px-5">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-finance-dining/[0.12] text-finance-dining">
          <Icon name="dining" size={24} />
        </span>
        <p className="text-ui-30 font-extrabold tnum">
          $62 <span className="text-ui-15 font-medium mut">of $80 this week</span>
        </p>
      </div>
      <section className="mx-4 mt-4 card p-4">
        <div className="mb-3 flex justify-between text-ui-13">
          <h2 className="font-semibold">Weekly spend</h2>
          <p className="mut">cap $80 ┄</p>
        </div>
        <div className="relative flex h-[100px] items-end gap-2">
          {weeks.map((week) => (
            <div key={week.label} className="flex flex-1 flex-col items-center gap-1">
              <div className={`w-full rounded-t-lg ${week.color}`} style={{ height: week.height }} />
              <span className="text-ui-10 mut">{week.label}</span>
            </div>
          ))}
          <div className="absolute inset-x-0 border-t border-dashed border-finance-dining" style={{ bottom: 104 }} />
        </div>
      </section>
      <h2 className="mt-4 px-5 text-ui-15 font-bold">This week</h2>
      <ul className="px-5">
        <li className="flex items-center gap-3 py-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-finance-dining/[0.12] text-finance-dining">
            <Icon name="dining" size={19} />
          </span>
          <span className="flex-1">
            <span className="block text-ui-14.5 font-semibold">Joe&apos;s Pizza</span>
            <span className="block text-ui-12 mut">Today · Card ••••</span>
          </span>
          <span className="text-ui-14.5 font-semibold tnum">−$14.50</span>
        </li>
        <li>
          <button type="button" className="flex w-full items-center gap-3 py-2.5 text-left" onClick={() => setOpen(true)}>
            <span className="grid h-10 w-10 place-items-center rounded-full bg-finance-dining/[0.12] text-finance-dining">
              <Icon name="dining" size={19} />
            </span>
            <span className="flex-1">
              <span className="block text-ui-14.5 font-semibold">Sweetgreen</span>
              <span className="block text-ui-12 mut">Wed · tap to recategorize</span>
            </span>
            <span className="text-ui-14.5 font-semibold tnum">−$16.25</span>
          </button>
        </li>
      </ul>
      {open ? (
        <Sheet title="Recategorize" frame onClose={() => setOpen(false)}>
          <div className="card flex justify-between rounded-2xl p-3">
            <div>
              <p className="text-ui-15 font-semibold">Sweetgreen</p>
              <p className="text-ui-12 mut">Wed Nov 4 · −$16.25</p>
            </div>
            <button type="button" className="self-center text-ui-12 mut" onClick={() => setDemo("Demo only. Nothing was saved.")}>
              Edit name <Icon name="pencil" size={14} />
            </button>
          </div>
          <fieldset className="mt-4">
            <legend className="text-ui-13 font-semibold mut">Move to</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {categories.map((category) => {
                const selected = choice === category;
                return (
                  <label key={category} className="cursor-pointer">
                    <input
                      className="sr-only"
                      type="radio"
                      name="category"
                      value={category}
                      checked={selected}
                      onChange={() => setChoice(category)}
                    />
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-ui-13.5 font-semibold ${
                        selected ? "border-transparent bg-finance-primary text-white" : "border-line"
                      } ${selected ? "" : chipColor[category]}`}
                    >
                      <Icon name={chipIcon[category]} size={15} />
                      {category}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line py-3">
            <div>
              <p className="text-ui-14.5 font-semibold">Always for &quot;Sweetgreen&quot;</p>
              <p className="text-ui-12 mut">Create a rule for future charges</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={always}
              onClick={() => setAlways((value) => !value)}
              className={`h-7 w-12 rounded-full p-0.5 ${always ? "bg-finance-primary" : "bg-line"}`}
            >
              <span className={`block h-6 w-6 rounded-full bg-white shadow ${always ? "ml-auto" : ""}`} />
              <span className="sr-only">{always ? "Rule on" : "Rule off"}</span>
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-line py-3">
            <span className="text-ui-14.5 font-semibold">Weekly cap — Dining Out</span>
            <span className="rounded-xl bg-page px-3 py-1.5 font-bold tnum">
              $80 <Icon name="pencil" size={13} />
            </span>
          </div>
          <button
            type="button"
            className="mt-2 flex h-12 w-full items-center justify-center rounded-2xl bg-finance-primary font-bold text-white"
            onClick={() => setDemo("Demo only. Nothing was saved.")}
          >
            Save
          </button>
          {demo ? (
            <p role="status" className="mt-2 text-center text-ui-12 mut">
              {demo}
            </p>
          ) : null}
          <p className="mt-2 text-center text-ui-9.5 text-inactive">EXAMPLE DATA</p>
        </Sheet>
      ) : null}
      {demo && !open ? (
        <p role="status" className="mt-3 text-center text-ui-12 mut">
          {demo}
        </p>
      ) : null}
    </div>
  );
}
