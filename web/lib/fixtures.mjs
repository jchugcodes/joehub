import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function candidates() {
  const found = [];
  try {
    found.push(fileURLToPath(new URL("./fixtures.json", import.meta.url)));
  } catch {
    // The Next compiler can expose a non-file module URL.
  }
  found.push(`${process.cwd()}/lib/fixtures.json`);
  found.push(`${process.cwd()}/web/lib/fixtures.json`);
  return found;
}

export function loadFixtures() {
  let last;
  for (const candidate of candidates()) {
    try {
      return JSON.parse(readFileSync(candidate, "utf8"));
    } catch (error) {
      last = error;
    }
  }
  throw last || new Error("synthetic fixtures not found");
}
