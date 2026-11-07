"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { JobsTabs } from "../../components/JobsTabs";
import { pipeline } from "../../lib/design-fixtures";

const DEMO = "Demo only. Nothing was saved.";

const valueClass: Record<string, string> = {
  jobs: "text-jobs",
  interview: "text-finance-subscriptions",
  finance: "text-finance-primary",
};

type View = "list" | "loading" | "empty" | "error";

function viewFrom(value: string | null): View {
  if (value === "loading" || value === "empty" || value === "error") return value;
  return "list";
}

export default function JobsPage() {
  const requested = useSearchParams().get("view");
  const [view, setView] = useState<View>(viewFrom(requested));
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setView(viewFrom(requested));
    setBusy(false);
  }, [requested]);

  function demo() {
    setNotice(DEMO);
  }

  function retry() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    window.setTimeout(() => {
      setBusy(false);
      setView("list");
      setNotice(DEMO);
    }, 400);
  }

  return (
    <div className="min-w-0">
      <header className="flex items-start justify-between px-5">
        <div>
          <p className="text-ui-13 text-muted">Jobs</p>
          <h1 className="text-ui-22 font-bold">Pipeline</h1>
        </div>
        {view === "list" ? (
          <button
            type="button"
            className="card grid h-11 w-11 place-items-center rounded-full"
            aria-label="Filter pipeline"
            onClick={demo}
          >
            <Icon name="filter" size={18} />
          </button>
        ) : null}
      </header>
      {view === "list" ? <JobsTabs current="Overview" /> : null}
      {notice ? (
        <p className="mx-5 mt-3 text-ui-13 font-semibold text-support-linkBlue" role="status">
          {notice}
        </p>
      ) : null}
      {view === "loading" ? <Loading /> : null}
      {view === "empty" ? <Empty onAdd={demo} /> : null}
      {view === "error" ? <ErrorState busy={busy} onRetry={retry} /> : null}
      {view === "list" ? <Pipeline onDemo={demo} /> : null}
      <p className="mb-4 mt-6 text-center text-ui-10 text-muted">SYNTHETIC DATA · design reference</p>
    </div>
  );
}

function Loading() {
  return (
    <div>
      <div className="space-y-3 px-4 pt-4" aria-hidden="true">
        <div className="card p-4">
          <div className="h-[18px] w-2/5 rounded-lg bg-line" />
          <div className="mt-3 h-[100px] rounded-lg bg-line" />
        </div>
        <div className="card p-4">
          <div className="h-[22px] w-[65%] rounded-lg bg-line" />
          <div className="mt-3 h-[50px] w-[90%] rounded-lg bg-line" />
        </div>
      </div>
      <p className="mt-5 px-5 text-ui-12 text-muted" role="status">
        Loading your pipeline…
      </p>
    </div>
  );
}

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="px-4">
      <div className="card mt-4 p-4 text-left">
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-jobs/10 text-jobs">
          <Icon name="jobs" size={24} />
        </div>
        <h2 className="text-ui-20 font-bold">Your next chapter starts here</h2>
        <p className="mt-2 text-ui-14 leading-relaxed text-muted">
          Save a role to keep its notes, next step and stage in one place. No applications yet.
        </p>
      </div>
      <div className="mt-4 space-y-3">
        <Link
          href="/jobs#matches"
          className="flex min-h-11 items-center justify-center rounded-xl bg-support-linkBlue px-4 text-ui-14 font-bold text-white"
        >
          Explore matches
        </Link>
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-center rounded-xl border border-support-linkBlue px-4 text-ui-14 font-bold text-support-linkBlue"
          onClick={onAdd}
        >
          Add a role
        </button>
      </div>
    </div>
  );
}

function ErrorState({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return (
    <div>
      <div className="px-4">
        <div className="card mt-4 p-4 text-left">
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-finance-dining/10 text-finance-dining">
            <Icon name="subscriptions" size={24} />
          </div>
          <h2 className="text-ui-20 font-bold">Pipeline unavailable</h2>
          <p className="mt-2 text-ui-14 leading-relaxed text-muted">
            We couldn’t load your roles. Your saved applications haven’t been changed.
          </p>
        </div>
        <div className="mt-4">
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-center rounded-xl bg-support-linkBlue px-4 text-ui-14 font-bold text-white disabled:opacity-60"
            onClick={onRetry}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Retrying…" : "Retry"}
          </button>
        </div>
      </div>
      <p className="mt-5 px-5 text-left text-ui-12 text-muted">No cached pipeline available</p>
    </div>
  );
}

function Pipeline({ onDemo }: { onDemo: () => void }) {
  return (
    <>
      <ul className="mt-4 grid min-w-0 grid-cols-3 gap-2.5 px-4">
        {pipeline.counts.map((item) => (
          <li key={item.label} className="card min-w-0 p-3 [overflow-wrap:anywhere]">
            <p className="text-ui-12 text-muted">{item.label}</p>
            <p className={`text-ui-28 font-extrabold tabular-nums ${valueClass[item.tone]}`}>{item.value}</p>
            <p className="text-ui-11 text-muted">{item.note}</p>
          </li>
        ))}
      </ul>
      <div id="overview" className="mt-4 flex min-w-0 items-end justify-between gap-2 px-5">
        <h2 className="shrink-0 text-ui-17 font-bold">Board</h2>
        <span className="flex min-w-0 items-center justify-end gap-1 text-right text-ui-12 text-muted">
          drag cards · swipe <Icon name="swipe" size={14} />
        </span>
      </div>
      <div
        id="board"
        tabIndex={0}
        aria-label="Pipeline columns"
        className="scroll-x mt-2 flex min-w-0 gap-2.5 overflow-x-auto px-4 pb-1"
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
          const node = event.currentTarget;
          const column = node.querySelector("section");
          const gap = parseFloat(getComputedStyle(node).columnGap || "0") || 0;
          const distance = (column?.getBoundingClientRect().width ?? 150) + gap;
          node.scrollBy({ left: event.key === "ArrowRight" ? distance : -distance });
          event.preventDefault();
        }}
      >
        {pipeline.columns.map((column) => (
          <section key={column.name} aria-label={column.name} className="w-[150px] shrink-0 rounded-2xl border border-line bg-white/60 p-2.5">
            <header className="mb-2 flex items-center justify-between text-ui-12 font-bold">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: column.dot }} />
                {column.name}
              </span>
              <span className="font-medium text-muted">{column.total}</span>
            </header>
            {column.cards.map((card) => {
              const body = (
                <>
                  <span>{card}</span>
                  <Icon name="grip" size={14} className="shrink-0 text-[#C9CEC8]" />
                </>
              );
              const className = "card mb-1.5 flex w-full items-start justify-between p-2.5 text-left text-ui-12 font-semibold";
              if (card.startsWith("Globex")) {
                return (
                  <Link key={card} href="/jobs/globex" className={className} style={{ borderRadius: 12 }}>
                    {body}
                  </Link>
                );
              }
              return (
                <p key={card} className={className} style={{ borderRadius: 12 }}>
                  {body}
                </p>
              );
            })}
          </section>
        ))}
      </div>
      <div id="matches" className="mt-5 flex min-w-0 items-end justify-between gap-2 px-5">
        <h2 className="text-ui-17 font-bold">Top matches</h2>
        <span className="text-ui-13 font-semibold text-support-linkBlue">See all 24</span>
      </div>
      <ul className="mt-2.5 space-y-2.5 px-4">
        {pipeline.matches.map((match) => (
          <li key={match.id} className="card p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink text-ui-16 font-bold text-white">{match.initial}</span>
              <div className="min-w-0 flex-1">
                <p className="text-ui-15 font-bold">{match.title}</p>
                <p className="text-ui-12 text-muted">{match.meta}</p>
              </div>
              <p className="text-right">
                <span className={`text-ui-20 font-extrabold tabular-nums ${match.scoreClass}`}>{match.score}</span>
                <span className="block text-ui-10 text-muted">/10 fit</span>
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {match.tags.map((tag) => (
                <span
                  key={tag.label}
                  className={`rounded-lg px-2 py-1 text-ui-11 font-medium ${tag.tint ? "bg-jobs/10 text-support-linkBlue" : "bg-page text-muted"}`}
                >
                  {tag.label}
                </span>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-xl bg-support-linkBlue px-3 text-ui-13 font-bold text-white"
                onClick={onDemo}
              >
                Save to pipeline
              </button>
              <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line" aria-label={`Dismiss ${match.title}`} onClick={onDemo}>
                <Icon name="close" size={16} className="text-muted" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
