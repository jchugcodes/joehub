"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FinanceTabs } from "./FinanceTabs";
import { Icon } from "./Icon";

type Cap = { slug: string; name: string; capCents: number };

const ORDER = ["dining-out", "groceries", "transport", "subscriptions", "shopping", "utilities"];

function dollars(cents: number) {
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

function parseDollars(value: string) {
  const text = value.trim();
  if (text === "") return { ok: true, cents: 0 };
  if (text.startsWith("-") || text.startsWith("−")) return { ok: false, cents: 0, detail: "Can’t be negative." };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, cents: 0 };
  return { ok: true, cents: Math.round(Number(text) * 100) };
}

export function FinanceCaps() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [envelope, setEnvelope] = useState(39000);
  const [error, setError] = useState("");
  const [field, setField] = useState("");
  const [offline, setOffline] = useState(false);
  const [ready, setReady] = useState(false);
  const [backHref, setBackHref] = useState("/finance");
  const [saving, setSaving] = useState(false);
  const idempotency = useRef("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const query = new URLSearchParams();
    if (params.get("asOf")) query.set("asOf", params.get("asOf") || "");
    if (params.get("week")) query.set("week", params.get("week") || "");
    const suffix = query.toString() ? `?${query.toString()}` : "";
    setBackHref(`/finance${suffix}`);
    const onOffline = () => setOffline(true);
    const onOnline = () => setOffline(false);
    setOffline(!navigator.onLine);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    void fetch(`/api/finance/overview${suffix}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("overview");
        const body = (await response.json()) as { caps: Cap[] };
        const next: Record<string, string> = {};
        const labels: Record<string, string> = {};
        let total = 0;
        for (const cap of body.caps) {
          if (typeof cap.capCents !== "number") continue;
          next[cap.slug] = cap.capCents ? dollars(cap.capCents) : "";
          labels[cap.slug] = cap.name;
          total += cap.capCents;
        }
        setFields(next);
        setNames(labels);
        setEnvelope(total);
        setReady(true);
      })
      .catch(() => setError("Finance is unavailable."));
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  const back = () => {
    const params = new URLSearchParams(window.location.search);
    const query = new URLSearchParams();
    if (params.get("asOf")) query.set("asOf", params.get("asOf") || "");
    if (params.get("week")) query.set("week", params.get("week") || "");
    window.location.assign(`/finance${query.toString() ? `?${query.toString()}` : ""}`);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const draftTotal = ORDER.reduce((sum, slug) => {
    const parsed = parseDollars(fields[slug] || "");
    return sum + (parsed.ok ? parsed.cents : 0);
  }, 0);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (offline || saving) return;
    const caps: Record<string, number> = {};
    for (const slug of ORDER) {
      const parsed = parseDollars(fields[slug] || "");
      if (!parsed.ok) {
        setError(parsed.detail || "Enter an amount.");
        setField(slug);
        document.getElementById(`cap-${slug}`)?.focus();
        return;
      }
      caps[slug] = parsed.cents;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/finance/caps", {
        method: "PATCH",
        headers: { "content-type": "application/json", "idempotency-key": idempotency.current || (idempotency.current = crypto.randomUUID()) },
        body: JSON.stringify({ caps }),
      });
      const body = (await response.json()) as { detail?: string; field?: string };
      if (!response.ok) {
        setError(body.detail || "Couldn’t save.");
        setField(body.field || "");
        if (body.field) document.getElementById(`cap-${body.field}`)?.focus();
        return;
      }
      back();
    } catch {
      setError("Couldn’t save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="finance-type min-w-0 text-ink" data-ready={ready ? "true" : undefined}>
      <div className="flex items-center gap-2 px-3 pt-2">
        <Link href={backHref} aria-label="Back to overview" className="grid h-11 w-11 place-items-center" onClick={(event) => { event.preventDefault(); back(); }}>
          <Icon name="back" size={20} />
        </Link>
        <h1 className="text-title font-medium">Weekly caps</h1>
      </div>
      <div className="mt-3">
        <FinanceTabs />
      </div>
      <form className="px-5 pt-5" onSubmit={save}>
        <p className="text-body">
          {dollars(draftTotal) === dollars(envelope) ? `$${dollars(envelope)} set` : `$${dollars(draftTotal)} of $${dollars(envelope)}`}
        </p>
        <div className="mt-4 space-y-3">
          {ORDER.map((slug) => (
            <label key={slug} className="block" htmlFor={`cap-${slug}`}>
              <span className="text-meta text-muted">{names[slug] || slug}</span>
              <input
                id={`cap-${slug}`}
                inputMode="decimal"
                value={fields[slug] ?? ""}
                disabled={offline || !ready}
                aria-invalid={field === slug}
                className="mt-1 h-12 w-full rounded-xl border border-line bg-page px-3 text-body"
                onChange={(event) => {
                  setFields((current) => ({ ...current, [slug]: event.target.value }));
                  setField("");
                  setError("");
                }}
              />
            </label>
          ))}
        </div>
        {error ? <p className="mt-3 text-body text-[#E07A5F]">{error}</p> : null}
        {offline ? <p className="mt-3 text-body">Can’t edit offline</p> : null}
        <div className="mt-5 flex gap-3">
          <button type="button" className="min-h-11 flex-1 rounded-xl border border-line text-body" onClick={back}>
            Cancel
          </button>
          <button type="submit" className="min-h-11 flex-1 rounded-xl bg-ink text-body text-page disabled:opacity-40" disabled={offline || saving || !ready}>
            Save
          </button>
        </div>
      </form>
    </main>
  );
}
