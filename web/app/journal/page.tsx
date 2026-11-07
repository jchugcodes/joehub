"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { journal } from "../../lib/design-fixtures";
import { DEMO_NOTICE, readFilter, readScroll, writeFilter, writeScroll, type JournalFilter } from "../../lib/journal-session";

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
            <p className="mt-1 inline-block rounded-lg bg-ink/40 px-1 py-0.5 text-ui-12 text-white">{journal.streakNote}</p>
          </div>
          <p className="max-w-full rounded-lg bg-ink/40 px-1 py-0.5 text-right text-ui-12 text-white">
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

export default function JournalPage() {
  const router = useRouter();
  const params = useSearchParams();
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

  const view = resolved ? "feed" : requested === "loading" || requested === "empty" || requested === "error" || requested === "filtered" ? requested : "feed";
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

  return (
    <div data-ready={ready ? "true" : "false"}>
      <header className="px-5">
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
                onClick={() => setFilter(item.id)}
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

      {view === "loading" ? (
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

      {view === "empty" ? (
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

      {view === "error" ? (
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

      {showFiltered ? (
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
            <button type="button" className="action-link action-link-secondary mt-3" onClick={() => router.push("/journal")}>
              Show all entries
            </button>
          </div>
        </div>
      ) : null}

      {view === "feed" && groups.length > 0 ? (
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
                      className="card block overflow-hidden text-left"
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

      {view === "feed" && groups.length > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center">
          <div className="relative h-0 w-full max-w-phone">
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
}
