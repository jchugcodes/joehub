// Per-area store selection. Unset means Upstash, which is the production default.
// Each area has its own flag. Setting one does not move the others.

const AREAS = [
  { area: "tasks", name: "JOEHUB_BACKEND_TASKS" },
  { area: "grocery", name: "JOEHUB_BACKEND_GROCERY" },
];
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
