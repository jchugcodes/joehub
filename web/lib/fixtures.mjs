import { readFileSync } from "node:fs";
import { join } from "node:path";

function fixturesPath() {
  const candidates = [
    join(process.cwd(), "contract", "fixtures.json"),
    join(process.cwd(), "..", "contract", "fixtures.json"),
  ];
  for (const candidate of candidates) {
    try {
      return { path: candidate, text: readFileSync(candidate, "utf8") };
    } catch {
      // The Next app runs with cwd at web/, tests may run at the repo root.
    }
  }
  throw new Error("synthetic fixtures not found");
}

export function loadFixtures() {
  return JSON.parse(fixturesPath().text);
}
