/** In-memory only. A refresh drops this. Nothing is written to storage or the API. */

export const DEMO_NOTICE = "Demo only. Nothing was saved.";
export const WIN_ERROR = "Write one thing that went well before adding your entry.";
export const PLACE_ERROR = "Add a place before adding this date.";
export const ENTRY_DATE = "2026-11-06";

export type JournalMode = "win" | "date";
export type JournalRating = "Loved" | "Meh" | "Never again";
export type JournalFilter = "feed" | "wins" | "dates" | "places";

export type JournalDraft = {
  mode: JournalMode;
  winText: string;
  winNote: string;
  place: string;
  rating: JournalRating;
  dateNote: string;
  entryDate: string;
  dirty: boolean;
};

export function blankDraft(mode: JournalMode = "win"): JournalDraft {
  return {
    mode,
    winText: "",
    winNote: "",
    place: "",
    rating: "Loved",
    dateNote: "",
    entryDate: ENTRY_DATE,
    dirty: false,
  };
}

let draft = blankDraft();
let filter: JournalFilter = "feed";
let scroll = 0;

export function readDraft() {
  return draft;
}

export function writeDraft(next: JournalDraft) {
  draft = next;
}

export function clearDraft() {
  draft = blankDraft();
}

export function readFilter() {
  return filter;
}

export function writeFilter(next: JournalFilter) {
  filter = next;
}

export function readScroll() {
  return scroll;
}

export function writeScroll(next: number) {
  scroll = next;
}

export function formatEntryDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "Nov 6, 2026";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
