"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "../../../components/Icon";

const DEMO = "Demo only. Nothing was saved.";

const fields = [
  { id: "dining", name: "Dining Out", icon: "dining", tint: "bg-finance-dining/10 text-finance-dining", start: "80.00" },
  { id: "groceries", name: "Groceries", icon: "groceries", tint: "bg-finance-primary/10 text-finance-primary", start: "120.00" },
  { id: "transport", name: "Transport", icon: "transport", tint: "bg-finance-transport/10 text-finance-transport", start: "60.00" },
  { id: "subscriptions", name: "Subscriptions", icon: "subscriptions", tint: "bg-finance-subscriptions/10 text-finance-subscriptions", start: "55.00" },
  { id: "shopping", name: "Shopping", icon: "shopping", tint: "bg-finance-shopping/10 text-finance-shopping", start: "75.00" },
  { id: "utilities", name: "Utilities", icon: "utilities", tint: "bg-finance-utilities/10 text-finance-utilities", start: "45.00" },
];

function capProblem(raw: string) {
  const text = raw.trim().replaceAll("−", "-");
  if (text === "") return "";
  const fraction = text.split(".")[1];
  if (!/^\d+(\.\d+)?$/.test(text) || (fraction && fraction.length > 2)) return "Enter $0 or more, or clear the cap.";
  return "";
}

export default function CapEditorPage() {
  const errorView = useSearchParams().get("view") === "error";
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((field) => [field.id, errorView && field.id === "groceries" ? "−10.00" : field.start])),
  );
  const [showErrors, setShowErrors] = useState(errorView);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (errorView) document.getElementById("cap-groceries")?.focus();
  }, [errorView]);

  function preview() {
    const first = fields.find((field) => capProblem(values[field.id]));
    setShowErrors(true);
    if (first) {
      setNotice("");
      document.getElementById(`cap-${first.id}`)?.focus();
      return;
    }
    setNotice(DEMO);
  }

  return (
    <div className="min-w-0">
      <header className="flex items-center gap-3 px-5">
        <Link href="/finance" className="grid h-11 w-11 place-items-center" aria-label="Back to Finance">
          <Icon name="back" size={22} />
        </Link>
        <div>
          <p className="text-ui-13 text-muted">Finance</p>
          <h1 className="text-ui-22 font-bold">Edit weekly caps</h1>
        </div>
      </header>
      <p className="mx-4 mt-4 rounded-xl border border-line bg-white p-3 text-ui-12 text-ink">
        SYNTHETIC PREVIEW · Draft only. No settings are saved.
      </p>
      <form
        className="px-4"
        onSubmit={(event) => {
          event.preventDefault();
          preview();
        }}
      >
        <section className="card mt-4 p-4">
          <h2 className="text-ui-16 font-bold">One cap for each category</h2>
          <p className="mt-1 text-ui-13 text-muted">These are weekly, not your $4,204 monthly plan.</p>
          {fields.map((field) => {
            const message = showErrors ? capProblem(values[field.id]) : "";
            return (
              <div key={field.id} className="border-b border-line py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${field.tint}`}>
                    <Icon name={field.icon} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-ui-15 font-semibold">{field.name}</span>
                    <span className="block text-ui-12 text-muted">Weekly cap</span>
                  </span>
                  <label
                    className={`flex min-h-11 w-[110px] items-center justify-between rounded-xl border bg-white px-3 text-ui-15 font-semibold tabular-nums ${
                      message ? "border-finance-dining" : "border-subtle-border"
                    }`}
                  >
                    <span className="text-muted">$</span>
                    <input
                      id={`cap-${field.id}`}
                      aria-label={`${field.name} weekly cap in dollars`}
                      aria-invalid={message ? true : undefined}
                      aria-describedby={message ? `cap-${field.id}-error` : undefined}
                      inputMode="decimal"
                      value={values[field.id]}
                      onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                      className="w-full bg-transparent text-right outline-none"
                    />
                  </label>
                </div>
                {message ? (
                  <p id={`cap-${field.id}-error`} className="mt-2 pl-12 text-ui-12 font-semibold text-ink">
                    {message}
                  </p>
                ) : null}
              </div>
            );
          })}
          <p className="mt-4 text-ui-12 text-muted">$0 or an empty value means no cap. Up to two decimal places. Reset timing follows your budget settings.</p>
        </section>
        <button type="submit" className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-finance-primary px-4 text-ui-19 font-bold text-white">
          Preview changes
        </button>
        <Link href="/finance" className="mt-2 flex min-h-11 w-full items-center justify-center text-ui-14 font-semibold">
          Cancel · discard draft
        </Link>
        {notice ? (
          <p role="status" className="mt-3 text-center text-ui-13 font-semibold text-ink">
            {notice}
          </p>
        ) : null}
      </form>
      <p className="mb-4 mt-6 text-center text-ui-10 text-muted">SYNTHETIC DATA · design reference</p>
    </div>
  );
}
