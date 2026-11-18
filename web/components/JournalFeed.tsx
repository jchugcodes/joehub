"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useOverlayHolds, useOverlays, useSkeletonHolds, useSkeletons } from "./LivePages";
import { OverlayPanel } from "./OverlayPanel";
import { JournalSkeleton, LoadError, RefreshBar } from "./Skeleton";
import { useSkeletonPhase } from "./SkeletonHold";
import { journal } from "../lib/design-fixtures";
import { DEMO_NOTICE, readFilter, readScroll, writeFilter, writeScroll, type JournalFilter } from "../lib/journal-session";
import { focusReturnSelector, readOverlayHold } from "../lib/overlay-motion.mjs";
import { readSkeletonHold } from "../lib/skeleton-gate.mjs";

const filters: { id: JournalFilter; label: string }[] = [
  { id: "feed", label: "Feed" },
  { id: "wins", label: "Wins" },
  { id: "dates", label: "Dates" },
  { id: "places", label: "Places" },
];

function matches(filter: JournalFilter, entry: (typeof journal.entries)[number]) {
  if (filter === "wins") return entry.kind === "win";
  if (filter === "dates") return entry.kind === "date";
  if (filter === "places") return entry.kind === "date" && entry.place.length > 0;
  return true;
}

function Streak() {
  return (
    <>
      <section className="mx-4 mt-4 rounded-card bg-gradient-to-br from-journal to-support-journalGradientEnd p-4 text-white" aria-label="Streak">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-ui-26 font-extrabold leading-none">{journal.streak}</p>
            <p className="mt-1 inline-block rounded-lg bg-ink/40 px-1 py-0.5 text-ui-12 text-page">{journal.streakNote}</p>
          </div>
          <p className="max-w-full rounded-lg bg-ink/40 px-1 py-0.5 text-right text-ui-12 text-page">
            {journal.month}
            <br />
            <b className="text-ui-15">{journal.monthNote}</b>
          </p>
        </div>
      </section>
      <div className="card mx-4 mt-2.5 flex justify-between px-3 py-3" aria-hidden="true">
        {journal.days.map((day, index) => (
          <div key={`${day}-${index}`} className="flex flex-col items-center gap-1">
            <span className="text-ui-10.5 text-ink">{day}</span>
            <span className={`grid h-8 w-8 place-items-center rounded-full text-ui-12 ${journal.done[index] ? "bg-journal text-white" : "bg-line text-ink"}`}>
              {journal.done[index] ? "✓" : ""}
            </span>
          </div>
        ))}
      </div>
      <p className="sr-only">Example week. Monday through Friday are marked. Saturday and Sunday are open. These are not buttons.</p>
    </>
  );
}

export function JournalFeed({ selectedSlug = "" }: { selectedSlug?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const overlayOn = useOverlays();
  const overlayHold = readOverlayHold(params, useOverlayHolds());
  const requested = params.get("view");
  const queryFilter = params.get("filter");
  const [filter, setFilter] = useState<JournalFilter>(() => {
    if (params.get("view") === "filtered") {
      if (queryFilter === "wins" || queryFilter === "dates" || queryFilter === "places") return queryFilter;
      return "places";
    }
    if (queryFilter === "wins" || queryFilter === "dates" || queryFilter === "places") return queryFilter;
    return readFilter();
  });
  const [resolved, setResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [wide, setWide] = useState(false);
  const [tone, setTone] = useState("");
  const skeletonOn = useSkeletons();
  const holdsOn = useSkeletonHolds();
  const hold = readSkeletonHold(params, holdsOn);

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
    if (!overlayOn || selectedSlug) return;
    const back = sessionStorage.getItem("joehub.journal.return");
    if (!back) return;
    const selector = focusReturnSelector(back);
    const link = selector ? document.querySelector(selector) : null;
    if (link instanceof HTMLElement) link.focus();
    sessionStorage.removeItem("joehub.journal.return");
  }, [overlayOn, selectedSlug]);

  useEffect(() => {
    setReady(true);
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (id) {
      const node = document.getElementById(id);
      if (node instanceof HTMLElement) {
        node.focus();
        node.scrollIntoView({ block: "center" });
      }
      return;
    }
    if (params.get("view") === "filtered") {
      const selected = document.querySelector("[aria-label='Journal filters'] [aria-pressed='true']");
      if (selected instanceof HTMLElement) selected.focus();
    }
    const y = readScroll();
    if (y > 0) window.scrollTo(0, y);
  }, []);

  useEffect(() => () => writeScroll(window.scrollY), []);
  useEffect(() => writeFilter(filter), [filter]);

  const special = requested === "loading" || requested === "empty" || requested === "error" || requested === "filtered" ? requested : "feed";
  const view = (resolved || (special === "filtered" && filter === "feed")) ? "feed" : special;
  const { phase, refreshing } = useSkeletonPhase(skeletonOn, hold, view === "loading", view === "feed" || view === "filtered");
  const bones = skeletonOn && (hold === "skel" || (view === "loading" && phase === "skeleton"));
  const showError = skeletonOn && hold === "error";
  const showEmptyHold = skeletonOn && hold === "empty";
  const blocked = bones || showError || showEmptyHold;
  const panelOffline = overlayHold === "offline" || tone === "offline";
  const selected = journal.entries.find((entry) => entry.slug === selectedSlug) || null;
  const visible = view === "filtered" ? [] : journal.entries.filter((entry) => matches(filter, entry));
  const groups = visible.reduce<{ label: string; entries: typeof visible }[]>((rows, entry) => {
    const last = rows[rows.length - 1];
    if (last && last.label === entry.group) last.entries.push(entry);
    else rows.push({ label: entry.group, entries: [entry] });
    return rows;
  }, []);

  function retry() {
    if (busy) return;
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      setResolved(true);
      setNotice(DEMO_NOTICE);
    }, 300);
  }

  function showAll() {
    writeFilter("feed");
    setFilter("feed");
    setResolved(true);
    router.push("/journal");
  }

  function closeOverlay() {
    if (selectedSlug) sessionStorage.setItem("joehub.journal.return", selectedSlug);
    const next = new URLSearchParams();
    const xe = params.get("xe");
    if (xe) next.set("xe", xe);
    const query = next.toString();
    router.push(query ? `/journal?${query}` : "/journal");
  }

  function chooseFilter(next: JournalFilter) {
    if (next === "feed" && requested === "filtered") {
      showAll();
      return;
    }
    writeFilter(next);
    setFilter(next);
  }

  const filteredCopy =
    filter === "wins"
      ? {
          title: "No wins yet",
          body: "No nightly wins match this filter. Your other entries are still in Feed.",
          action: "Write your first entry",
          href: "/journal/compose",
        }
      : filter === "dates"
        ? {
            title: "No dates yet",
            body: "No date entries match this filter. Your other entries are still in Feed.",
            action: "Add a date",
            href: "/journal/compose?mode=date",
          }
        : {
            title: "No places yet",
            body: "No entries with a place match this filter. Your other entries are still in Feed.",
            action: "Add a date",
            href: "/journal/compose?mode=date",
          };
  const showFiltered = view === "filtered" || (view === "feed" && groups.length === 0);

  const detailBody = (
    <div className="px-5 py-4 text-left text-body text-ink" data-journal-detail="true">
      {overlayHold === "error" ? (
        <p role="alert" className="text-body text-ink">Couldn’t load that entry.</p>
      ) : selected ? (
        <>
          {selected.kind === "date" && selected.place ? (
            <div
              data-journal-part="hero"
              className={`relative h-20 overflow-hidden rounded-2xl ${selected.media === "lilac" ? "bg-gradient-to-br from-finance-subscriptions to-support-paleRose" : "bg-gradient-to-br from-journal to-support-paleRose"}`}
            >
              <span className="absolute bottom-2 left-3 rounded-lg bg-white px-2 py-1 text-ui-12 font-semibold text-ink">{selected.place}</span>
            </div>
          ) : null}
          {selected.kind === "date" && selected.when ? (
            <p data-journal-part="meta" className="mt-3 text-ui-12 text-ink">{selected.when}</p>
          ) : null}
          {selected.kind === "win" && selected.badge ? (
            <p data-journal-part="meta" className="text-ui-12 text-ink">{selected.badge}</p>
          ) : null}
          {selected.kind === "date" && selected.rating ? (
            <p className="mt-2">
              <span
                data-journal-part="rating"
                className={`inline-flex rounded-full px-2.5 py-1 text-ui-12 font-bold text-ink ${selected.rating === "Never again" ? "bg-finance-dining/15" : "bg-finance-primary/15"}`}
              >
                {selected.rating}
              </span>
            </p>
          ) : null}
          {selected.kind === "win" ? (
            <ul className="mt-3 space-y-1.5">
              {selected.checks.map((check) => (
                <li key={check.text} className="flex gap-2 text-body text-ink">
                  <span aria-hidden="true" className={check.ok ? "text-finance-primary" : "text-finance-dining"}>
                    {check.ok ? "✓" : "×"}
                  </span>
                  {check.text}
                </li>
              ))}
            </ul>
          ) : null}
          <p data-journal-part="note" className="mt-3 text-ui-14 text-ink">{selected.kind === "date" ? selected.note || selected.body : selected.body}</p>
          {panelOffline ? (
            <p role="status" data-state="offline" className="mt-4 rounded-2xl bg-table-header px-4 py-3 text-left text-body text-ink dark:bg-white/10">
              You are offline.
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-body text-ink">That entry is not here.</p>
      )}
    </div>
  );

  const detailPanel = (panelWide: boolean) =>
    selectedSlug ? (
      <OverlayPanel wide={panelWide} title={selected?.title || "Entry"} onClose={closeOverlay}>
        {detailBody}
      </OverlayPanel>
    ) : null;

  const feed = (
    <div data-ready={ready ? "true" : "false"}>
      <header className="relative px-5">
        {refreshing ? <RefreshBar /> : null}
        <p className="text-ui-13 text-ink">Journal</p>
        <h1 className="text-ui-22 font-bold">Wins & dates</h1>
      </header>
      <div className="journal-filters mt-3 w-full min-w-0 overflow-x-auto border-b border-line" role="group" aria-label="Journal filters">
        <div className="flex w-max min-w-full gap-6 px-5">
          {filters.map((item) => {
            const selected = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                className={`min-h-11 shrink-0 border-b-[2.5px] py-3 text-ui-15 text-ink ${selected ? "border-journal font-bold" : "border-transparent font-medium"}`}
                onClick={() => chooseFilter(item.id)}
                onFocus={(event) => event.currentTarget.scrollIntoView({ inline: "nearest", block: "nearest" })}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      {notice ? (
        <p role="status" className="px-4 pt-3 text-ui-14 text-ink">
          {notice}
        </p>
      ) : null}
      {overlayOn && panelOffline ? (
        <p role="status" data-state="offline" className="mx-4 mt-3 rounded-2xl bg-table-header px-4 py-3 text-left text-body text-ink dark:bg-white/10">
          You are offline.
        </p>
      ) : null}

      {bones ? <JournalSkeleton /> : null}
      {showError ? <LoadError onRetry={retry} /> : null}
      {showEmptyHold ? <p className="px-5 py-16 text-center text-body" data-state="empty">No entries.</p> : null}
      {!blocked && view === "loading" && !skeletonOn ? (
        <div className="mt-4 px-4" aria-busy="true">
          {[0, 1, 2].map((item) => (
            <div key={item} className={`card p-4 ${item === 0 ? "" : "mt-3"}`} aria-hidden="true">
              <div className="h-4 w-32 rounded bg-line" />
              <div className="mt-4 h-24 rounded-xl bg-line" />
            </div>
          ))}
          <p role="status" className="mt-5 text-ui-13 text-ink">
            Loading your journal…
          </p>
        </div>
      ) : null}

      {!blocked && view === "empty" ? (
        <div className="mt-4 px-4">
          <div className="card p-4 text-left">
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-journal/10 text-ui-24 text-journal" aria-hidden="true">
              ＋
            </div>
            <h2 className="text-ui-20 font-bold">A small win counts</h2>
            <p className="mt-2 text-ui-14 leading-relaxed text-ink">A good meal, a kind moment, getting through today. Start with one thing you want to remember.</p>
          </div>
          <div className="mt-4 space-y-3">
            <Link href="/journal/compose" className="action-link">
              Write your first entry
            </Link>
            <Link href="/journal/compose?mode=date" className="action-link action-link-secondary">
              Add a date
            </Link>
          </div>
        </div>
      ) : null}

      {!blocked && view === "error" ? (
        <div className="mt-4 px-4">
          <div className="card p-4 text-left">
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-journal/10 text-ui-24 text-journal" aria-hidden="true">
              ↻
            </div>
            <h2 className="text-ui-20 font-bold">Journal unavailable</h2>
            <p className="mt-2 text-ui-14 leading-relaxed text-ink">We couldn’t load your entries. Your saved journal hasn’t been changed.</p>
          </div>
          <button
            type="button"
            className="action-link mt-4"
            onClick={retry}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Retrying…" : "Retry"}
          </button>
          <p className="mt-5 text-ui-12 text-ink">No cached entries available</p>
        </div>
      ) : null}

      {!blocked && showFiltered ? (
        <div>
          <Streak />
          <div className="mt-3 px-4">
            <div className="card p-4 text-left">
              <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-journal/10 text-ui-24 text-journal" aria-hidden="true">
                ＋
              </div>
              <h2 className="text-ui-20 font-bold" role="status">
                {filteredCopy.title}
              </h2>
              <p className="mt-2 text-ui-14 leading-relaxed text-ink">{filteredCopy.body}</p>
            </div>
            <Link href={filteredCopy.href} className="action-link mt-4">
              {filteredCopy.action}
            </Link>
            <button type="button" className="action-link action-link-secondary mt-3" onClick={showAll}>
              Show all entries
            </button>
          </div>
        </div>
      ) : null}

      {!blocked && view === "feed" && groups.length > 0 ? (
        <div className="pb-[64px]">
          <Streak />
          <div className="mt-3 space-y-2.5 px-4">
            {groups.map((group) => (
              <section key={group.label}>
                <h2 className="pt-2 text-ui-12 font-semibold text-ink">{group.label}</h2>
                <div className="mt-2 space-y-2.5">
                  {group.entries.map((entry) => (
                    <Link
                      key={entry.slug}
                      id={entry.slug}
                      href={`/journal/${entry.slug}`}
                      data-entry={entry.slug}
                      className={`card block overflow-hidden text-left${overlayOn ? " min-h-11 text-ink hover:text-ink focus:text-ink" : ""}${overlayOn && entry.slug === selectedSlug ? " row-selected" : ""}`}
                    >
                      {entry.kind === "win" ? (
                        <span className="block p-4">
                          <span className="flex items-center justify-between gap-3">
                            <span className="text-ui-12 font-bold uppercase tracking-wide text-ink">{entry.title}</span>
                            <span className="text-ui-12 text-ink">{entry.badge}</span>
                          </span>
                          <span className="mt-2 block space-y-1.5 text-ui-14">
                            {entry.checks.map((check) => (
                              <span key={check.text} className="flex gap-2 text-ink">
                                <span aria-hidden="true" className={check.ok ? "text-finance-primary" : "text-finance-dining"}>
                                  {check.ok ? "✓" : "×"}
                                </span>
                                {check.text}
                              </span>
                            ))}
                          </span>
                        </span>
                      ) : (
                        <>
                          <span
                            className={`relative block h-20 ${entry.media === "lilac" ? "bg-gradient-to-br from-finance-subscriptions to-support-paleRose" : "bg-gradient-to-br from-journal to-support-paleRose"}`}
                            aria-hidden="true"
                          >
                            <span className="absolute bottom-2 left-3 rounded-lg bg-white px-2 py-1 text-ui-12 font-semibold text-ink">{entry.place}</span>
                          </span>
                          <span className="block p-4">
                            <span className="flex items-center justify-between gap-3">
                              <span className="min-w-0 flex-1 break-words text-ui-16 font-bold text-ink">{entry.title}</span>
                              <span
                                className={`rounded-full px-2.5 py-1 text-ui-12 font-bold text-ink ${entry.rating === "Never again" ? "bg-finance-dining/15" : "bg-finance-primary/15"}`}
                              >
                                {entry.rating}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-ui-12 text-ink">{entry.when}</span>
                            <span className="mt-2 block text-ui-14 text-ink">{entry.note}</span>
                          </span>
                        </>
                      )}
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}

      {!blocked && view === "feed" && groups.length > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center">
          <div className={`relative h-0 w-full ${wide && overlayOn ? "max-w-[1080px]" : "max-w-phone"}`}>
            <Link
              id="new-entry"
              href="/journal/compose"
              aria-label="New entry"
              className="pointer-events-auto absolute bottom-[calc(var(--primary-nav-height,84px)+16px)] right-5 grid h-14 w-14 place-items-center rounded-full bg-journal text-ui-28 font-bold text-white"
            >
              <span aria-hidden="true">+</span>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="min-w-0" data-layout={wide ? "panel" : "sheet"}>
      <div className={wide && overlayOn && selectedSlug ? "flex min-w-0 items-start gap-6" : "min-w-0"}>
        <div className="min-w-0 flex-1">{feed}</div>
        {overlayOn && wide && selectedSlug ? detailPanel(true) : null}
      </div>
      {overlayOn && !wide && selectedSlug ? detailPanel(false) : null}
    </div>
  );
}
