"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { JobsTabs } from "./JobsTabs";
import { useOverlayHolds, useOverlays, useSkeletonHolds, useSkeletons } from "./LivePages";
import { OverlayPanel } from "./OverlayPanel";
import { JobsSkeleton, LoadError, RefreshBar } from "./Skeleton";
import { useSkeletonPhase } from "./SkeletonHold";
import { jobDetail, pipeline } from "../lib/design-fixtures";
import { focusReturnSelector, readOverlayHold } from "../lib/overlay-motion.mjs";
import { readSkeletonHold } from "../lib/skeleton-gate.mjs";

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

export function JobsScreen({ selectedId = "" }: { selectedId?: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const requested = search.get("view");
  const skeletonOn = useSkeletons();
  const holdsOn = useSkeletonHolds();
  const hold = readSkeletonHold(search, holdsOn);
  const overlayOn = useOverlays();
  const overlayHold = readOverlayHold(search, useOverlayHolds());
  const [view, setView] = useState<View>(viewFrom(requested));
  const [busy, setBusy] = useState(false);
  const [wide, setWide] = useState(false);
  const [tone, setTone] = useState("");
  const { phase, refreshing } = useSkeletonPhase(skeletonOn, hold, view === "loading", view === "list");
  const bones = skeletonOn && (hold === "skel" || (view === "loading" && phase === "skeleton"));
  const showError = skeletonOn && hold === "error";
  const showEmptyHold = skeletonOn && hold === "empty";
  const blocked = bones || showError || showEmptyHold;
  const panelOffline = overlayHold === "offline" || tone === "offline";
  const role = selectedId === jobDetail.id ? jobDetail : null;

  useEffect(() => {
    setView(viewFrom(requested));
    setBusy(false);
  }, [requested]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const apply = () => setWide(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!overlayOn) return;
    const onOffline = () => setTone("offline");
    const onOnline = () => setTone("");
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    if (typeof navigator !== "undefined" && navigator.onLine === false) setTone("offline");
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [overlayOn]);

  useEffect(() => {
    if (!overlayOn || selectedId) return;
    const back = sessionStorage.getItem("joehub.jobs.return");
    if (!back) return;
    const selector = focusReturnSelector(back);
    const link = selector ? document.querySelector(selector) : null;
    if (link instanceof HTMLElement) link.focus();
    sessionStorage.removeItem("joehub.jobs.return");
  }, [overlayOn, selectedId]);

  function retry() {
    if (busy) return;
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      setView("list");
    }, 400);
  }

  function closeOverlay() {
    if (selectedId) sessionStorage.setItem("joehub.jobs.return", selectedId);
    const params = new URLSearchParams();
    const xe = search.get("xe");
    if (xe) params.set("xe", xe);
    const query = params.toString();
    router.push(query ? `/jobs?${query}` : "/jobs");
  }

  const list = (
    <div className="min-w-0">
      <header className="relative flex items-start justify-between px-5">
        {refreshing ? <RefreshBar /> : null}
        <div>
          <p className="text-ui-13 text-muted">Jobs</p>
          <h1 className="text-ui-22 font-bold text-ink">Pipeline</h1>
        </div>
      </header>
      {view === "list" && !showError && !showEmptyHold ? <JobsTabs current="Overview" /> : null}
      {overlayOn && panelOffline ? (
        <p role="status" data-state="offline" className="mx-5 mt-3 rounded-2xl bg-table-header px-4 py-3 text-left text-body text-ink dark:bg-white/10">
          You are offline.
        </p>
      ) : null}
      {view === "loading" && !skeletonOn ? <Loading /> : null}
      {bones ? <JobsSkeleton /> : null}
      {showError ? <LoadError onRetry={retry} /> : null}
      {showEmptyHold ? <p className="px-5 py-16 text-center text-body" data-state="empty">No jobs.</p> : null}
      {!blocked && view === "empty" ? <Empty /> : null}
      {!blocked && view === "error" ? <ErrorState busy={busy} onRetry={retry} /> : null}
      {!blocked && (view === "list" || hold === "refresh") ? (
        <Pipeline overlayOn={overlayOn} selectedId={selectedId} />
      ) : null}
      {blocked ? null : <p className="mb-4 mt-6 text-center text-ui-10 text-muted">SYNTHETIC DATA · design reference</p>}
    </div>
  );

  const detailBody = (
    <div className="px-5 py-4 text-left text-body text-ink" data-job-detail="true">
      {overlayHold === "error" ? (
        <p role="alert" className="text-body text-ink">Couldn’t load that role.</p>
      ) : role ? (
        <RoleDetail offline={panelOffline} />
      ) : (
        <p className="text-body text-ink">The handoff draws a detail only for Globex. This page does not invent one.</p>
      )}
    </div>
  );

  const detailPanel = (panelWide: boolean) =>
    selectedId ? (
      <OverlayPanel wide={panelWide} title={role?.title || "Job"} onClose={closeOverlay}>
        {detailBody}
      </OverlayPanel>
    ) : null;

  return (
    <div className="min-w-0" data-layout={wide ? "panel" : "sheet"}>
      <div className={wide && overlayOn && selectedId ? "flex min-w-0 items-start gap-6" : "min-w-0"}>
        <div className="min-w-0 flex-1">{list}</div>
        {overlayOn && wide && selectedId ? detailPanel(true) : null}
      </div>
      {overlayOn && !wide && selectedId ? detailPanel(false) : null}
    </div>
  );
}

function RoleDetail({ offline }: { offline: boolean }) {
  const current = jobDetail.statuses.indexOf(jobDetail.current);
  return (
    <>
      <div className="flex items-start gap-3">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-ink text-ui-22 font-bold text-page">{jobDetail.initial}</span>
        <p className="min-w-0 pt-1 text-body text-muted">{jobDetail.meta}</p>
      </div>
      <section className="card mt-4 p-4" aria-labelledby="job-status">
        <h2 id="job-status" className="text-body font-medium text-ink">
          Status
        </h2>
        <ol className="mt-3 grid grid-cols-4 gap-1">
          {jobDetail.statuses.map((item, index) => {
            const done = index < current;
            const here = index === current;
            return (
              <li key={item} className="min-w-0 text-center">
                <span
                  className={`mx-auto grid h-7 w-7 place-items-center rounded-full ${
                    done ? "bg-support-linkBlue text-white" : here ? "bg-finance-subscriptions text-white" : "bg-line text-muted"
                  }`}
                >
                  {done ? <Icon name="check" size={16} /> : null}
                </span>
                <span className={`mt-1 block text-ui-11 ${here ? "font-bold text-ink" : "text-muted"}`}>{item}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 flex min-h-11 items-center gap-2 text-body text-ink">
          <span className="h-2 w-2 shrink-0 rounded-full bg-finance-subscriptions" />
          {jobDetail.round}
        </p>
      </section>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <section className="card min-w-0 p-3 [overflow-wrap:anywhere]">
          <h2 className="text-ui-12 font-semibold text-muted">Fit score</h2>
          <p className="text-ink">
            <span data-fit-score="" className="text-ui-26 font-extrabold tabular-nums text-finance-primary">{jobDetail.fit}</span>
            <span className="text-ui-13 text-muted">/10</span>
          </p>
          <p className="text-ui-11 text-muted">{jobDetail.fitNote}</p>
        </section>
        <section className="card min-w-0 p-3 [overflow-wrap:anywhere]">
          <h2 className="text-ui-12 font-semibold text-muted">Next step</h2>
          <p className="mt-1 text-ui-15 font-bold text-ink">{jobDetail.next}</p>
          <p className="text-ui-12 text-muted">{jobDetail.nextNote}</p>
        </section>
      </div>
      <h2 className="mt-5 text-ui-16 font-bold text-ink">Notes</h2>
      <ul className="mt-2 space-y-2">
        {jobDetail.notes.map((note) => (
          <li key={note.when} className="card p-4">
            <p className="text-ui-11 text-muted">{note.when}</p>
            <p className="mt-1 text-body text-ink">{note.body}</p>
          </li>
        ))}
      </ul>
      {offline ? (
        <p role="status" data-state="offline" className="mt-4 rounded-2xl bg-table-header px-4 py-3 text-left text-body text-ink dark:bg-white/10">
          You are offline.
        </p>
      ) : null}
    </>
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

function Empty() {
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

function Pipeline({ overlayOn, selectedId }: { overlayOn: boolean; selectedId: string }) {
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
        <h2 className="shrink-0 text-ui-17 font-bold text-ink">Board</h2>
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
              if (card.startsWith("Globex")) {
                const selected = overlayOn && selectedId === jobDetail.id;
                const className = `card mb-1.5 flex w-full items-start justify-between p-2.5 text-left text-ui-12 font-semibold${
                  overlayOn ? " min-h-11 text-ink hover:text-ink focus:text-ink" : ""
                }${selected ? " row-selected" : ""}`;
                return (
                  <Link key={card} href="/jobs/globex" data-job="globex" className={className} style={{ borderRadius: 12 }}>
                    {body}
                  </Link>
                );
              }
              return (
                <p key={card} className="card mb-1.5 flex w-full items-start justify-between p-2.5 text-left text-ui-12 font-semibold" style={{ borderRadius: 12 }}>
                  {body}
                </p>
              );
            })}
          </section>
        ))}
      </div>
      <div id="matches" className="mt-5 flex min-w-0 items-end justify-between gap-2 px-5">
        <h2 className="text-ui-17 font-bold text-ink">Top matches</h2>
        <span className="text-ui-13 font-semibold text-support-linkBlue">See all 24</span>
      </div>
      <ul className="mt-2.5 space-y-2.5 px-4">
        {pipeline.matches.map((match) => (
          <li key={match.id} className="card p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink text-ui-16 font-bold text-page">{match.initial}</span>
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
          </li>
        ))}
      </ul>
    </>
  );
}
