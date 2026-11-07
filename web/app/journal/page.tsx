"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Sheet } from "../../components/Sheet";
import { journal } from "../../lib/design-fixtures";

const moods = [
  { id: "Loved", tone: "border-finance-primary text-finance-primary" },
  { id: "Meh", tone: "border-finance-shopping text-finance-shopping" },
  { id: "Never again", tone: "border-finance-dining text-finance-dining" },
];

function JournalScreen() {
  const params = useSearchParams();
  const [open, setOpen] = useState(params.get("compose") === "1");
  const [tab, setTab] = useState<"win" | "date">("date");
  const [place, setPlace] = useState("Kiki's, Lower East Side");
  const [mood, setMood] = useState("Loved");
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState(journal.entries);
  const [status, setStatus] = useState("");

  return (
    <div className="space-y-4 px-4">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted">Journal</p>
          <h1 className="text-ui-22 font-bold">Wins & dates</h1>
        </div>
        <button type="button" className="grid h-10 w-10 place-items-center rounded-full bg-surface" aria-label="Search journal">
          ⌕
        </button>
      </header>
      <nav aria-label="Journal sections" className="flex gap-4 text-sm">
        <a href="#feed" className="border-b-2 border-journal pb-2 font-semibold" aria-current="page">
          Feed
        </a>
        <a href="#wins" className="pb-2 text-muted">
          Wins
        </a>
        <a href="#dates" className="pb-2 text-muted">
          Dates
        </a>
        <a href="#places" className="pb-2 text-muted">
          Places
        </a>
      </nav>
      <section
        className="rounded-card p-4 text-white"
        style={{ background: "linear-gradient(135deg,#C2577A,#8E5BA8)" }}
        aria-label="Streak"
      >
        <div className="flex items-end justify-between">
          <div>
            <p className="text-ui-26 font-extrabold leading-none">{journal.streak}</p>
            <p className="text-sm">{journal.streakNote}</p>
          </div>
          <div className="text-right text-sm">
            <p>{journal.month}</p>
            <p>{journal.monthNote}</p>
          </div>
        </div>
      </section>
      <ul className="grid grid-cols-7 gap-2 text-center text-xs" aria-label="This week">
        {journal.days.map((day, index) => (
          <li key={`${day}-${index}`}>
            <p className="text-muted">{day}</p>
            <span
              className={`mt-1 grid h-8 w-8 place-items-center rounded-full ${
                journal.done[index] ? "bg-journal text-white" : "bg-line text-muted"
              }`}
            >
              {journal.done[index] ? "✓" : ""}
            </span>
          </li>
        ))}
      </ul>
      <section id="wins" className="card p-4">
        <div className="flex justify-between text-xs font-semibold tracking-wide text-muted">
          <h2>NIGHTLY WINS</h2>
          <p>Tonight · Fri</p>
        </div>
        <ul className="mt-2 space-y-1 text-sm">
          {journal.wins.map((win) => (
            <li key={win.text}>
              <span className={win.ok ? "text-finance-primary" : "text-finance-dining"}>{win.ok ? "✓" : "✕"}</span> {win.text}
            </li>
          ))}
        </ul>
      </section>
      <ul id="dates" className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.title} id="places" className="card p-4">
            <p className="text-xs text-muted">{entry.place}</p>
            <div className="mt-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{entry.title}</h2>
              <p className="text-sm text-finance-primary">{entry.mood}</p>
            </div>
            <p className="text-sm text-muted">{entry.when}</p>
            <p className="mt-2">{entry.body}</p>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="fixed bottom-[100px] right-4 grid h-14 w-14 place-items-center rounded-full bg-journal text-ui-24 text-white shadow-xl lg:bottom-8"
        aria-label="Add to journal"
        onClick={() => setOpen(true)}
      >
        +
      </button>
      {open ? (
        <Sheet title="Add to journal" onClose={() => setOpen(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setEntries((current) => [
                { place, title: place, when: "Tonight", mood, body: note || "No note." },
                ...current,
              ]);
              setStatus("Added on this page only. Not sent to the API.");
              setOpen(false);
            }}
          >
            <fieldset className="grid grid-cols-2 gap-2 rounded-2xl bg-page p-1">
              <legend className="sr-only">Entry kind</legend>
              {(["win", "date"] as const).map((kind) => (
                <label key={kind} className="cursor-pointer">
                  <input
                    className="sr-only"
                    type="radio"
                    name="entry-kind"
                    value={kind}
                    checked={tab === kind}
                    onChange={() => setTab(kind)}
                  />
                  <span
                    className={`block rounded-xl py-2 text-center ${
                      tab === kind ? "bg-surface font-semibold text-journal shadow-sm" : "bg-page"
                    }`}
                  >
                    {kind === "win" ? "Nightly win" : "Date"}
                  </span>
                </label>
              ))}
            </fieldset>
            <label htmlFor="place" className="mt-4 block text-sm">
              Place
            </label>
            <input
              id="place"
              className="mt-1 w-full rounded-xl border border-journal px-3 py-2"
              value={place}
              onChange={(event) => setPlace(event.target.value)}
            />
            <fieldset className="mt-4">
              <legend className="text-sm">How was it?</legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {moods.map((item) => (
                  <label
                    key={item.id}
                    className={`rounded-xl border p-2 text-center text-sm ${
                      mood === item.id ? `${item.tone} bg-page font-semibold` : "border-line text-muted"
                    }`}
                  >
                    <input
                      className="sr-only"
                      type="radio"
                      name="mood"
                      value={item.id}
                      checked={mood === item.id}
                      onChange={() => setMood(item.id)}
                    />
                    {item.id}
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor="journal-note" className="mt-4 block text-sm">
              Note
            </label>
            <textarea
              id="journal-note"
              className="mt-1 w-full rounded-xl border border-line px-3 py-2"
              rows={3}
              placeholder="What stood out?"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <button type="submit" className="mt-4 w-full rounded-full bg-journal py-3 font-semibold text-white">
              Add to journal
            </button>
            <p className="mt-2 text-center text-xs tracking-wide text-muted">EXAMPLE DATA</p>
          </form>
        </Sheet>
      ) : null}
      {status ? (
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      ) : null}
    </div>
  );
}

export default function JournalPage() {
  return (
    <Suspense fallback={<p>Loading journal</p>}>
      <JournalScreen />
    </Suspense>
  );
}
