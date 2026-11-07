"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  DEMO_NOTICE,
  PLACE_ERROR,
  WIN_ERROR,
  blankDraft,
  clearDraft,
  formatEntryDate,
  readDraft,
  writeDraft,
  type JournalDraft,
  type JournalMode,
  type JournalRating,
} from "../../../lib/journal-session";

const ratings: JournalRating[] = ["Loved", "Meh", "Never again"];

function seeded(mode: JournalMode, view: string | null): JournalDraft {
  const base = blankDraft(mode);
  if (view === "typing" || view === "saving" || view === "saved") {
    if (mode === "date") return { ...base, place: "Lilia", dateNote: "Cacio e pepe fritelle." };
    return { ...base, winText: "Finished Globex take-home." };
  }
  return base;
}

export default function ComposePage() {
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get("view");
  const queryMode: JournalMode = params.get("mode") === "date" ? "date" : "win";
  const stored = readDraft();
  const restore = view == null && stored.dirty;
  const initial = restore ? stored : seeded(queryMode, view);
  const [draft, setDraft] = useState<JournalDraft>(initial);
  const [phase, setPhase] = useState<"edit" | "saving" | "saved">(view === "saving" ? "saving" : view === "saved" ? "saved" : "edit");
  const [error, setError] = useState(view === "error" ? (queryMode === "date" ? PLACE_ERROR : WIN_ERROR) : "");
  const [notice, setNotice] = useState(view === "saved" ? DEMO_NOTICE : "");
  const [ready, setReady] = useState(false);
  const winRef = useRef<HTMLTextAreaElement>(null);
  const placeRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);
  const epoch = useRef(0);
  const saving = phase === "saving";

  function cancelPending() {
    epoch.current += 1;
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => {
    setReady(true);
    if (view === "typing" || view === "error") {
      const field = (restore ? stored.mode : queryMode) === "date" ? placeRef.current : winRef.current;
      field?.focus();
    }
    return () => {
      epoch.current += 1;
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
    // Focus the frame's field once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(next: JournalDraft) {
    const dirty = { ...next, dirty: true };
    setDraft(dirty);
    writeDraft(dirty);
    setError("");
  }

  function leave() {
    cancelPending();
    if (!draft.dirty) clearDraft();
    router.push("/journal#new-entry");
  }

  function submit() {
    if (phase !== "edit") return;
    const problem = draft.mode === "win" ? (draft.winText.trim() ? "" : WIN_ERROR) : draft.place.trim() ? "" : PLACE_ERROR;
    if (problem) {
      setError(problem);
      (draft.mode === "date" ? placeRef.current : winRef.current)?.focus();
      return;
    }
    const snap = epoch.current + 1;
    epoch.current = snap;
    setPhase("saving");
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (epoch.current !== snap) return;
      clearDraft();
      setPhase("saved");
      setNotice(DEMO_NOTICE);
    }, 400);
  }

  const savedTitle = draft.mode === "date" ? "A date, remembered." : "A small win, remembered.";
  const savedLine = draft.mode === "date" ? draft.place : draft.winText;
  const savedMeta = `${formatEntryDate(draft.entryDate)} · ${draft.mode === "date" ? "Date" : "Nightly win"}`;

  if (phase === "saved") {
    return (
      <div data-ready={ready ? "true" : "false"}>
        <header className="px-5">
          <p className="text-ui-13 text-ink">Journal</p>
          <h1 className="text-ui-22 font-bold">Entry added</h1>
        </header>
        <div className="px-4 mt-5">
          <div className="card p-4 text-left">
            <div className="text-ui-26 text-finance-primary" aria-hidden="true">
              ✓
            </div>
            <h2 className="mt-3 text-ui-20 font-bold">{savedTitle}</h2>
            <p className="mt-3 text-ui-14 text-ink">{savedLine}</p>
            <p className="mt-2 text-ui-12 text-ink">{savedMeta}</p>
            <p className="mt-4 text-ui-13 text-ink">Synthetic saved-state preview. Nothing was written.</p>
            <p role="status" className="mt-2 text-ui-14 font-semibold text-ink">
              {notice}
            </p>
          </div>
          <button type="button" className="action-link mt-4" onClick={() => router.push("/journal#new-entry")}>
            Back to journal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-ready={ready ? "true" : "false"}>
      <header className="px-5">
        <p className="text-ui-13 text-ink">Journal</p>
        <h1 className="text-ui-22 font-bold">New entry</h1>
      </header>
      <p className="mt-4 px-5 text-ui-12 text-ink">Cancel returns to feed · draft stays local</p>
      {restore ? <p className="mt-2 px-5 text-ui-14 text-ink">Your draft is still here for this session.</p> : null}
      <p className="mx-4 mt-5 rounded-xl bg-journal/10 p-3 text-ui-12 text-ink">SYNTHETIC PREVIEW · no real journal write</p>
      <form
        className="mt-5 min-h-[calc(100svh-9rem)] rounded-t-[28px] bg-surface px-5 pb-8 pt-3"
        aria-busy={saving}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-support-handle" aria-hidden="true" />
        <div className="flex gap-1 rounded-xl bg-page p-1 text-ui-14 font-semibold" role="group" aria-label="Entry type">
          {(
            [
              ["win", "Nightly win"],
              ["date", "Date"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={draft.mode === id}
              disabled={saving}
              className={`min-h-11 flex-1 rounded-lg ${draft.mode === id ? "bg-white text-ink shadow-sm" : "text-ink"}`}
              onClick={() => update({ ...draft, mode: id })}
            >
              {label}
            </button>
          ))}
        </div>

        {draft.mode === "win" ? (
          <>
            <label htmlFor="win-text" className="mb-1.5 mt-4 block text-ui-12 font-semibold text-ink">
              One thing that went well · required
            </label>
            <textarea
              id="win-text"
              ref={winRef}
              value={draft.winText}
              disabled={saving}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "entry-error" : undefined}
              placeholder="What went well today?"
              className={`min-h-[72px] w-full rounded-xl border bg-white px-3 py-3 text-ui-15 text-ink ${error ? "border-finance-dining" : "border-subtle-border"}`}
              onChange={(event) => update({ ...draft, winText: event.target.value })}
            />
          </>
        ) : (
          <>
            <label htmlFor="place" className="mb-1.5 mt-4 block text-ui-12 font-semibold text-ink">
              Place · required
            </label>
            <input
              id="place"
              ref={placeRef}
              value={draft.place}
              disabled={saving}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "entry-error" : undefined}
              placeholder="Add a place"
              className={`min-h-11 w-full rounded-xl border bg-white px-3 text-ui-15 text-ink ${error ? "border-finance-dining" : "border-subtle-border"}`}
              onChange={(event) => update({ ...draft, place: event.target.value })}
            />
            <fieldset className="mt-4" disabled={saving}>
              <legend className="text-ui-12 font-semibold text-ink">How was it?</legend>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {ratings.map((rating) => (
                  <label
                    key={rating}
                    className={`relative flex min-h-11 items-center justify-center rounded-full border px-2 text-center text-ui-12 font-semibold text-ink ${draft.rating === rating ? "border-journal bg-support-paleRose" : "border-line bg-white"}`}
                  >
                    <input
                      type="radio"
                      name="rating"
                      value={rating}
                      checked={draft.rating === rating}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      onChange={() => update({ ...draft, rating })}
                    />
                    {rating}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}

        {error ? (
          <p id="entry-error" className="mt-2 text-ui-14 text-ink">
            {error}
          </p>
        ) : null}

        <label htmlFor="entry-note" className="mb-1.5 mt-4 block text-ui-12 font-semibold text-ink">
          Note · optional
        </label>
        <textarea
          id="entry-note"
          value={draft.mode === "date" ? draft.dateNote : draft.winNote}
          disabled={saving}
          placeholder={draft.mode === "date" ? "What stood out?" : "A little more to remember…"}
          className="min-h-[88px] w-full rounded-xl border border-subtle-border bg-white px-3 py-3 text-ui-15 text-ink"
          onChange={(event) =>
            update(draft.mode === "date" ? { ...draft, dateNote: event.target.value } : { ...draft, winNote: event.target.value })
          }
        />

        <label htmlFor="entry-date" className="mb-1.5 mt-4 block text-ui-12 font-semibold text-ink">
          Entry date
        </label>
        <input
          id="entry-date"
          type="date"
          value={draft.entryDate}
          disabled={saving}
          className="min-h-11 w-full min-w-0 max-w-full rounded-xl border border-subtle-border bg-white px-3 text-ui-15 text-ink"
          onChange={(event) => update({ ...draft, entryDate: event.target.value })}
        />
        <p className="mt-3 text-ui-12 text-ink">Photo and mood are not part of this build.</p>
        <button type="submit" className="action-link mt-5" disabled={saving}>
          {saving ? "Saving…" : "Add to journal"}
        </button>
        {saving ? (
          <p role="status" className="mt-3 text-ui-14 text-ink">
            Keep this open while your entry is saved.
          </p>
        ) : null}
        <button type="button" className="mt-2 flex min-h-11 w-full items-center justify-center text-ui-14 font-semibold text-ink" onClick={leave}>
          Cancel
        </button>
      </form>
    </div>
  );
}
