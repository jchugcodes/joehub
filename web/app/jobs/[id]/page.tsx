"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { jobDetail } from "../../../lib/design-fixtures";

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const [status, setStatus] = useState(jobDetail.current);
  const [draft, setDraft] = useState("Prep: STAR stories for stakeholder conflict");
  const [notes, setNotes] = useState(jobDetail.notes);
  const [message, setMessage] = useState("");
  if (params.id !== "globex") {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">No detail frame</h1>
        <p className="text-sm text-muted">Only the Globex example has a detail frame.</p>
        <Link href="/jobs" className="text-sm font-semibold text-jobs-text">
          Back to pipeline
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <Link href="/jobs" className="text-xl" aria-label="Back to pipeline">
          ‹
        </Link>
        <p className="font-medium">Job</p>
        <span className="w-6" />
      </header>
      <div className="flex gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ink text-lg font-semibold text-card">
          {jobDetail.initial}
        </span>
        <div>
          <h1 className="text-xl font-semibold">{jobDetail.title}</h1>
          <p className="text-sm text-muted">{jobDetail.meta}</p>
        </div>
      </div>
      <section className="rounded-2xl bg-card p-4 shadow-sm" aria-labelledby="status-heading">
        <div className="flex items-center justify-between">
          <h2 id="status-heading" className="font-medium">
            Status
          </h2>
          <p className="text-xs text-muted">tap to change</p>
        </div>
        <fieldset className="mt-3 grid grid-cols-4 gap-2">
          <legend className="sr-only">Application status</legend>
          {jobDetail.statuses.map((item) => {
            const index = jobDetail.statuses.indexOf(item);
            const current = jobDetail.statuses.indexOf(status);
            const reached = index <= current;
            return (
              <label key={item} className="cursor-pointer text-center text-xs">
                <input
                  className="sr-only"
                  type="radio"
                  name="job-status"
                  value={item}
                  checked={status === item}
                  onChange={() => setStatus(item)}
                />
                <span
                  className={`mx-auto grid h-8 w-8 place-items-center rounded-full ${
                    index === current ? "bg-interview text-white" : reached ? "bg-jobs-text text-white" : "bg-line text-muted"
                  }`}
                >
                  {reached ? "✓" : ""}
                </span>
                {item}
              </label>
            );
          })}
        </fieldset>
        <p className="mt-3 rounded-xl border border-line px-3 py-2 text-sm">{status} · Round 2</p>
      </section>
      <div className="grid grid-cols-2 gap-3">
        <section className="rounded-2xl bg-card p-3 shadow-sm">
          <h2 className="text-sm text-muted">Fit score</h2>
          <p className="text-2xl font-semibold text-finance-text">
            {jobDetail.fit}
            <span className="text-base text-muted">/10</span>
          </p>
          <p className="text-xs text-muted">{jobDetail.fitNote}</p>
        </section>
        <section className="rounded-2xl bg-card p-3 shadow-sm">
          <h2 className="text-sm text-muted">Next step</h2>
          <p className="font-semibold">{jobDetail.next}</p>
          <p className="text-xs text-muted">{jobDetail.nextNote}</p>
        </section>
      </div>
      <section id="notes" className="space-y-3">
        <h2 className="text-lg font-semibold">Notes</h2>
        {notes.map((note) => (
          <article key={note.when} className="rounded-2xl bg-card p-4 shadow-sm">
            <p className="text-xs text-muted">{note.when}</p>
            <p className="mt-1">{note.body}</p>
          </article>
        ))}
        <form
          className="rounded-2xl border border-jobs-text p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            setNotes((current) => [...current, { when: "Just now", body: draft.trim() }]);
            setDraft("");
            setMessage("Note kept in this page only.");
          }}
        >
          <label htmlFor="job-note" className="sr-only">
            Note
          </label>
          <textarea
            id="job-note"
            className="w-full bg-transparent"
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="rounded-full bg-jobs-text px-4 py-1 text-sm font-semibold text-white">
            Save
          </button>
        </form>
        {message ? (
          <p role="status" className="text-sm text-muted">
            {message}
          </p>
        ) : null}
      </section>
      <div className="grid grid-cols-2 gap-3">
        <a className="rounded-full border border-line py-3 text-center text-sm font-semibold" href="#posting">
          Open posting
        </a>
        <button
          type="button"
          className="rounded-full bg-finance-text py-3 text-sm font-semibold text-white"
          onClick={() => setStatus("Offer")}
        >
          Mark offer
        </button>
      </div>
      <p id="posting" className="text-sm text-muted">
        No posting URL is in the example. This does not leave the app.
      </p>
    </div>
  );
}
