"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "../../../components/Icon";
import { jobDetail } from "../../../lib/design-fixtures";

const DEMO = "Demo only. Nothing was saved.";

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("Prep: STAR stories for stakeholder conflict");
  if (params.id !== jobDetail.id) {
    return (
      <div className="px-5">
        <Link href="/jobs" className="inline-flex min-h-11 items-center gap-2 text-ui-15 font-semibold">
          <Icon name="back" size={24} /> Back to pipeline
        </Link>
        <h1 className="mt-4 text-ui-22 font-bold">No detail for this role</h1>
        <p className="mt-2 text-ui-14 text-muted">The handoff draws a detail only for Globex. This page does not invent one.</p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <header className="flex items-center gap-2 px-4">
        <Link href="/jobs" className="grid h-11 w-11 place-items-center" aria-label="Back to pipeline">
          <Icon name="back" size={24} />
        </Link>
        <h1 className="flex-1 text-center text-ui-15 font-semibold text-muted">Job</h1>
        <button type="button" className="grid h-11 w-11 place-items-center" aria-label="More actions" onClick={() => setNotice(DEMO)}>
          <Icon name="more" size={22} />
        </button>
      </header>
      {notice ? (
        <p className="mx-5 mt-3 text-ui-13 font-semibold text-support-linkBlue" role="status">
          {notice}
        </p>
      ) : null}
      <div className="mt-3 flex items-start gap-3 px-5">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-ink text-ui-22 font-bold text-white">{jobDetail.initial}</span>
        <div className="min-w-0">
          <p className="text-ui-20 font-bold">{jobDetail.title}</p>
          <p className="text-ui-13 text-muted">{jobDetail.meta}</p>
        </div>
      </div>
      <section className="card mx-4 mt-4 p-4" aria-labelledby="status-heading">
        <div className="flex items-baseline justify-between">
          <h2 id="status-heading" className="text-ui-13 font-semibold">
            Status
          </h2>
          <p className="text-ui-12 text-muted">tap to change</p>
        </div>
        <ol className="mt-3 grid grid-cols-4 gap-1">
          {jobDetail.statuses.map((item) => {
            const index = jobDetail.statuses.indexOf(item);
            const current = jobDetail.statuses.indexOf(jobDetail.current);
            const done = index < current;
            const here = index === current;
            return (
              <li key={item} className="min-w-0 text-center">
                <span
                  className={`mx-auto grid h-7 w-7 place-items-center rounded-full ${
                    done ? "bg-support-linkBlue text-white" : here ? "bg-finance-subscriptions text-white shadow-[0_0_0_5px_#8E7CC333]" : "bg-line text-muted"
                  }`}
                >
                  {done ? <Icon name="check" size={16} /> : null}
                </span>
                <span className={`mt-1 block text-ui-11 ${here ? "font-bold" : "text-muted"}`}>{item}</span>
              </li>
            );
          })}
        </ol>
        <Link
          href="/jobs/globex/stage"
          className="mt-3 flex h-11 items-center justify-between rounded-xl border border-line px-3 text-ui-14"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-finance-subscriptions" />
            <span className="truncate">{jobDetail.round}</span>
          </span>
          <Icon name="chevron" size={16} />
        </Link>
      </section>
      <div className="mt-3 grid grid-cols-2 gap-2.5 px-4">
        <section className="card min-w-0 p-3 [overflow-wrap:anywhere]">
          <h2 className="text-ui-12 font-semibold text-muted">Fit score</h2>
          <p>
            <span className="text-ui-26 font-extrabold tabular-nums text-finance-primary">{jobDetail.fit}</span>
            <span className="text-ui-13 text-muted">/10</span>
          </p>
          <p className="text-ui-11 text-muted">{jobDetail.fitNote}</p>
        </section>
        <section className="card min-w-0 p-3 [overflow-wrap:anywhere]">
          <h2 className="text-ui-12 font-semibold text-muted">Next step</h2>
          <p className="mt-1 flex items-center gap-1 text-ui-15 font-bold">
            <Icon name="calendar" size={13} /> {jobDetail.next}
          </p>
          <p className="text-ui-12 text-muted">{jobDetail.nextNote}</p>
        </section>
      </div>
      <div id="notes" className="mt-5 flex items-end justify-between px-5">
        <h2 className="text-ui-16 font-bold">Notes</h2>
        <button type="button" className="min-h-11 px-1 text-ui-13 font-semibold text-support-linkBlue" onClick={() => setNotice(DEMO)}>
          + Add
        </button>
      </div>
      <ul className="mt-2 space-y-2 px-4">
        {jobDetail.notes.map((note) => (
          <li key={note.when} className="card p-4">
            <p className="text-ui-11 text-muted">{note.when}</p>
            <p className="mt-1 text-ui-14">{note.body}</p>
          </li>
        ))}
      </ul>
      <form
        className="mx-4 mt-3 rounded-2xl border-2 border-jobs bg-white p-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice(DEMO);
        }}
      >
        <label className="block text-ui-14" htmlFor="note-draft">
          <span className="sr-only">Note draft</span>
          <textarea
            id="note-draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            className="w-full resize-none bg-transparent text-ui-14 outline-none"
          />
        </label>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-ui-11 text-muted">editing…</span>
          <button type="submit" className="min-h-11 rounded-lg bg-support-linkBlue px-4 text-ui-12 font-bold text-white">
            Save
          </button>
        </div>
      </form>
      <div className="mt-4 grid grid-cols-2 gap-2 px-4">
        <button
          type="button"
          className="flex h-11 items-center justify-center rounded-xl border border-line bg-white px-2 text-ui-14 font-semibold"
          onClick={() => setNotice(DEMO)}
        >
          Open posting
        </button>
        <button
          type="button"
          className="flex h-11 items-center justify-center rounded-xl bg-finance-primary px-2 text-ui-14 font-bold text-white"
          onClick={() => setNotice(DEMO)}
        >
          Mark offer
        </button>
      </div>
      <p className="mb-4 mt-6 text-center text-ui-10 text-muted">SYNTHETIC DATA · design reference</p>
    </div>
  );
}
