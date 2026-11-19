// Per-area store selection. Unset means Upstash, which is the production default.
// S1 only has Tasks. Later slices add a flag here without changing this parser.

const AREAS = [{ area: "tasks", name: "JOEHUB_BACKEND_TASKS" }];
const ALLOWED = new Set(["upstash", "sqlite"]);

export function readAreaBackends(env = process.env) {
  const areas = {};
  for (const { area, name } of AREAS) {
    const value = String(env[name] ?? "").trim();
    if (!value) {
      areas[area] = "upstash";
      continue;
    }
    if (!ALLOWED.has(value)) throw new Error(`refusing to start: unknown ${name} value`);
    areas[area] = value;
  }
  return areas;
}

export function anyAreaSqlite(areas) {
  return Object.values(areas).includes("sqlite");
}
