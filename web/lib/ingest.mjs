import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient } from "@libsql/client";
import { readAreaBackends } from "./backend.mjs";
import { isCalendarDate } from "./tasks.mjs";
import { readSourceId } from "./source-id.mjs";
import { createSqliteStore } from "./store-sqlite.mjs";

const DUMMY_HASH = "0".repeat(64);
const TASK_FIELDS = new Set(["title", "notes", "dueDate", "priority", "status", "project", "sourceId"]);
const PRIORITIES = new Set(["High", "Medium", "Low"]);
const CREATE_STATUSES = new Set(["To do", "Doing", "Blocked"]);
const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const ENTITY_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

export const INGEST_BODY_LIMIT = 16 * 1024;
export const INGEST_RATE_LIMIT = 60;
export const INGEST_RATE_WINDOW_MS = 60 * 1000;

// Tasks is not a box table, so table_registry and delegations do not name it.
// Delegations bind a human principal to an owner. This slice allows one owner.
export const INGEST_ENTITIES = {
  tasks: { owners: ["Cato"] },
};

export function tokenDigest(token) {
  return createHash("sha256").update(String(token), "utf8").digest("hex");
}

export function hashesEqual(left, right) {
  const a = Buffer.from(String(left), "utf8");
  const b = Buffer.from(String(right), "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(Buffer.from(DUMMY_HASH), Buffer.from(DUMMY_HASH));
    return false;
  }
  return timingSafeEqual(a, b);
}

export function withIngestHeaders(response, result) {
  if (result && Number.isInteger(result.retryAfter) && result.retryAfter > 0) {
    response.headers.set("retry-after", String(result.retryAfter));
  }
  return response;
}

export function taskIngestFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return ["body"];
  const fields = [];
  for (const key of Object.keys(body)) {
    if (!TASK_FIELDS.has(key)) fields.push(key);
  }
  const title = body.title;
  if (typeof title !== "string" || !title.trim() || title.trim().length > 200) fields.push("title");
  if (body.notes != null && body.notes !== "") {
    if (typeof body.notes !== "string" || body.notes.trim().length > 4000) fields.push("notes");
  }
  if (body.dueDate != null && body.dueDate !== "") {
    if (typeof body.dueDate !== "string" || !isCalendarDate(body.dueDate)) fields.push("dueDate");
  }
  if (body.priority != null && body.priority !== "") {
    if (typeof body.priority !== "string" || !PRIORITIES.has(body.priority)) fields.push("priority");
  }
  if (body.status != null && body.status !== "") {
    if (typeof body.status !== "string" || body.status === "Done" || !CREATE_STATUSES.has(body.status)) {
      fields.push("status");
    }
  }
  if (body.project != null && body.project !== "") {
    if (typeof body.project !== "string" || body.project.trim().length > 120) fields.push("project");
  }
  if (Object.prototype.hasOwnProperty.call(body, "sourceId") && !readSourceId(body.sourceId).ok) {
    fields.push("sourceId");
  }
  return [...new Set(fields)].sort();
}

function utcStamp(now) {
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function bearer(headers) {
  const trimmed = String(headers.get("authorization") || "").trim();
  if (!/^Bearer\s+\S+$/i.test(trimmed)) return "";
  const token = trimmed.slice(trimmed.indexOf(" ") + 1).trim();
  if (!token || token.length > 500) return "";
  return token;
}

function idempotencyKey(headers) {
  const value = headers.get("idempotency-key");
  if (value == null) return "";
  const key = value.trim();
  if (!KEY_PATTERN.test(key)) return "";
  return key;
}

function allowed(entity, principal) {
  if (typeof entity !== "string" || !ENTITY_PATTERN.test(entity)) return false;
  const spec = INGEST_ENTITIES[entity];
  if (!spec) return false;
  return principal.kind === "owner" && spec.owners.includes(principal.ownerName);
}

function retryAfterSeconds(now, windowMs) {
  const remain = windowMs - (now % windowMs);
  return Math.max(1, Math.ceil(remain / 1000));
}

async function openClient(env) {
  const url = String(env.JOEHUB_LIBSQL_URL || "").trim();
  if (!url) return null;
  const authToken = String(env.JOEHUB_LIBSQL_AUTH_TOKEN || "").trim();
  try {
    return createClient({ url, ...(authToken ? { authToken } : {}) });
  } catch {
    return null;
  }
}

async function authenticate(client, headers) {
  const presented = bearer(headers);
  if (!presented) return null;
  const digest = tokenDigest(presented);
  const found = await client.execute({
    sql: "SELECT id, name, kind, owner_name, token_sha256 FROM principals WHERE token_sha256 = ?",
    args: [digest],
  });
  const row = found.rows[0];
  const stored = row ? String(row.token_sha256) : DUMMY_HASH;
  const matches = hashesEqual(digest, stored);
  if (!row || !matches) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    kind: String(row.kind),
    ownerName: row.owner_name == null ? "" : String(row.owner_name),
  };
}

async function hitRate(client, principalId, now, limit, windowMs) {
  const windowStart = now - (now % windowMs);
  const result = await client.execute({
    sql: `INSERT INTO ingest_rate (principal_id, window_start, hits)
          VALUES (?, ?, 1)
          ON CONFLICT(principal_id, window_start) DO UPDATE SET hits = hits + 1
          RETURNING hits`,
    args: [principalId, windowStart],
  });
  let hits = Number(result.rows[0] && result.rows[0].hits);
  if (!Number.isInteger(hits)) {
    const again = await client.execute({
      sql: "SELECT hits FROM ingest_rate WHERE principal_id = ? AND window_start = ?",
      args: [principalId, windowStart],
    });
    hits = Number(again.rows[0] && again.rows[0].hits);
  }
  if (hits > limit) return { limited: true, retryAfter: retryAfterSeconds(now, windowMs) };
  return { limited: false };
}

async function releaseClaim(client, principalId, entity, key) {
  await client.execute({
    sql: `DELETE FROM ingest_idempotency
          WHERE principal_id = ? AND entity = ? AND idempotency_key = ? AND status_code = 0`,
    args: [principalId, entity, key],
  });
}

async function readClaim(client, principalId, entity, key) {
  const existing = await client.execute({
    sql: `SELECT body_sha256, status_code, response_json
          FROM ingest_idempotency
          WHERE principal_id = ? AND entity = ? AND idempotency_key = ?`,
    args: [principalId, entity, key],
  });
  return existing.rows[0] || null;
}

async function claimIdempotency(client, principal, entity, key, hash, now) {
  const nonce = randomUUID();
  await client.execute({
    sql: `INSERT INTO ingest_idempotency (
            principal_id, entity, idempotency_key, body_sha256, status_code, response_json, created_at
          ) VALUES (?, ?, ?, ?, 0, ?, ?)
          ON CONFLICT(principal_id, entity, idempotency_key) DO NOTHING`,
    args: [principal.id, entity, key, hash, nonce, now],
  });
  const row = await readClaim(client, principal.id, entity, key);
  if (row && String(row.response_json) === nonce && Number(row.status_code) === 0) return { claimed: true };
  if (!row || !hashesEqual(String(row.body_sha256), hash)) {
    return { claimed: false, status: 409, body: { detail: "That Idempotency-Key was already used." } };
  }
  if (Number(row.status_code) === 0) {
    return { claimed: false, status: 503, body: { detail: "unavailable" } };
  }
  return { claimed: false, status: Number(row.status_code), body: JSON.parse(String(row.response_json)) };
}

async function remember(client, principal, entity, key, created, now) {
  const responseJson = JSON.stringify(created.body);
  await client.execute({
    sql: `UPDATE ingest_idempotency
          SET status_code = ?, response_json = ?
          WHERE principal_id = ? AND entity = ? AND idempotency_key = ? AND status_code = 0`,
    args: [created.status, responseJson, principal.id, entity, key],
  });
  const saved = await readClaim(client, principal.id, entity, key);
  if (!saved || Number(saved.status_code) !== created.status || String(saved.response_json) !== responseJson) {
    throw new Error("unavailable");
  }
  const taskId = created.body && created.body.id ? String(created.body.id) : "";
  await client.execute({
    sql: `INSERT INTO bot_activity (
            id, notion_id, migrated_on, last_modified_by, last_modified_at,
            bot_name, action, occurred_at, detail
          ) VALUES (?, NULL, NULL, ?, ?, ?, 'ingest', ?, ?)`,
    args: [
      globalThis.crypto.randomUUID(),
      principal.name,
      utcStamp(now),
      principal.name,
      utcStamp(now),
      taskId ? `${entity}:${taskId}` : entity,
    ],
  });
}

function parsePayload(rawBody) {
  if (typeof rawBody !== "string" || Buffer.byteLength(rawBody, "utf8") > INGEST_BODY_LIMIT) {
    return { ok: false, fields: ["body"] };
  }
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, fields: ["body"] };
  }
  const fields = taskIngestFields(parsed);
  if (fields.length) return { ok: false, fields };
  return { ok: true, body: parsed };
}

async function ingestWithClient(client, input, env) {
  const headers = input.headers instanceof Headers ? input.headers : new Headers(input.headers || {});
  const now = typeof input.now === "number" ? input.now : Date.now();
  const limit = Number.isInteger(input.limit) ? input.limit : INGEST_RATE_LIMIT;
  const windowMs = Number.isInteger(input.windowMs) ? input.windowMs : INGEST_RATE_WINDOW_MS;
  const principal = await authenticate(client, headers);
  if (!principal) return { status: 401, body: { detail: "authentication required" } };
  const rate = await hitRate(client, principal.id, now, limit, windowMs);
  if (rate.limited) {
    return { status: 429, body: { detail: "Too many requests." }, retryAfter: rate.retryAfter };
  }
  if (!allowed(input.entity, principal)) return { status: 403, body: { detail: "not allowed" } };
  const key = idempotencyKey(headers);
  if (!key) return { status: 400, body: { fields: ["Idempotency-Key"] } };
  const payload = parsePayload(input.rawBody);
  if (!payload.ok) return { status: 400, body: { fields: payload.fields } };
  const hash = tokenDigest(input.rawBody);
  const claim = await claimIdempotency(client, principal, input.entity, key, hash, now);
  if (!claim.claimed) return { status: claim.status, body: claim.body };
  let created;
  try {
    const store = createSqliteStore({ client, env });
    created = await store.createTask(payload.body, "", now, "");
  } catch (error) {
    try {
      await releaseClaim(client, principal.id, input.entity, key);
    } catch {
      // Keep the original failure. The pending claim still blocks a second insert.
    }
    throw error;
  }
  if (!created || created.status !== 201) {
    await releaseClaim(client, principal.id, input.entity, key);
    if (created && created.status === 400) {
      const field = created.body && typeof created.body.field === "string" ? created.body.field : "body";
      return { status: 400, body: { fields: [field] } };
    }
    return { status: 503, body: { detail: "unavailable" } };
  }
  await remember(client, principal, input.entity, key, created, now);
  return { status: 201, body: created.body };
}

export async function handleIngest(input = {}) {
  const env = input.env || process.env;
  let areas;
  try {
    areas = readAreaBackends(env);
  } catch {
    return { status: 503, body: { detail: "unavailable" } };
  }
  if (areas.tasks !== "sqlite") return { status: 503, body: { detail: "ingest not enabled" } };
  const opened = input.client ? null : await openClient(env);
  const client = input.client || opened;
  if (!client) return { status: 503, body: { detail: "unavailable" } };
  try {
    return await ingestWithClient(client, input, env);
  } finally {
    if (opened) opened.close();
  }
}
