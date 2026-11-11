const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

export function readSourceId(value) {
  if (value == null || value === "") return { ok: true, sourceId: "" };
  if (typeof value !== "string") return { ok: false, field: "sourceId", detail: "Use a source id like notion:page-id." };
  const sourceId = value.trim();
  if (!SOURCE_ID.test(sourceId)) return { ok: false, field: "sourceId", detail: "Use a source id like notion:page-id." };
  return { ok: true, sourceId };
}

export function readOptionalSourceId(body, shown = {}) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, "sourceId")) {
    return { ok: true, sourceId: typeof shown.sourceId === "string" ? shown.sourceId : "" };
  }
  return readSourceId(body.sourceId);
}
