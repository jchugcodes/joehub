/** In-memory only. A refresh drops the filter and scroll. Nothing is written to storage or the API. */

export type JournalFilter = "feed" | "wins" | "dates" | "places";

let filter: JournalFilter = "feed";
let scroll = 0;

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
