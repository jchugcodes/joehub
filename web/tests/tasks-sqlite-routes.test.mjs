import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import {
  handleListDelete,
  handleListPatch,
  handleListsGet,
  handleListsPost,
  handleTaskComplete,
  handleTaskDelete,
  handleTaskGet,
  handleTaskPatch,
  handleTaskReopen,
  handleTasksGet,
  handleTasksPost,
} from "../lib/api.mjs";
import { handleIngest } from "../lib/ingest.mjs";
import { createLimiter } from "../lib/ratelimit.mjs";
import { seal } from "../lib/sessions.mjs";
import { createRuntime } from "../lib/store.mjs";
import { mintIngestToken } from "../scripts/ingest-token.mjs";
import { migrateLibsql } from "../scripts/libsql-migrate.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-19T06:25:00.000Z");
const SECRET = "tasks-route-secret-value";
const IP = "203.0.113.8";

function envFor(extra = {}) {
  return {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    JOEHUB_SESSION_SECRET: SECRET,
    ...extra,
  };
}

function headersFor(cookie, key = "") {
  return {
    get(name) {
      const lower = String(name || "").toLowerCase();
      if (lower === "cookie") return cookie ? `joehub_session=${cookie}` : "";
      if (lower === "idempotency-key") return key;
      return "";
    },
  };
}

function taskKey(command) {
  return command.some((part) => typeof part === "string" && /joehub:tasks?(?::|$)/.test(part));
}

async function openPair() {
  const fake = await startFakeUpstash();
  const base = await startFakeUpstash();
  const client = createClient({ url: ":memory:" });
  await migrateLibsql({ client, url: ":memory:", test: true });
  const session = {
    id: "session-fixed-route",
    deviceId: "device-fixed-route",
    createdAt: NOW,
    expiresAt: NOW + 14 * 24 * 60 * 60 * 1000,
    revoked: false,
    owner: "owner-subject",
    label: "browser",
  };
  const upstash = createRuntime(envFor({ UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token }), {});
  const sqlite = createRuntime(
    envFor({
      UPSTASH_REDIS_REST_URL: base.url,
      UPSTASH_REDIS_REST_TOKEN: base.token,
      JOEHUB_BACKEND_TASKS: "sqlite",
      JOEHUB_LIBSQL_URL: "libsql://example.turso.io",
    }),
    { tasksClient: client },
  );
  await upstash.store.putSession(session, NOW);
  await sqlite.store.putSession(session, NOW);
  return { fake, base, client, upstash, sqlite, cookie: seal(SECRET, session.id) };
}

test("task routes return the same responses on sqlite as on upstash", async () => {
  const pair = await openPair();
  const limiter = () => createLimiter(60);
  try {
    const anonymous = headersFor("");
    const upAnon = await handleTasksGet(anonymous, envFor(), pair.upstash.store, limiter(), NOW, IP, "http://127.0.0.1/api/tasks");
    const sqlAnon = await handleTasksGet(anonymous, envFor(), pair.sqlite.store, limiter(), NOW, IP, "http://127.0.0.1/api/tasks");
    assert.deepEqual(sqlAnon, upAnon);
    assert.equal(sqlAnon.status, 401);

    const headers = headersFor(pair.cookie, "route-1");
    const blankUp = await handleTasksPost({ title: "   " }, headers, envFor(), pair.upstash.store, limiter(), NOW, IP);
    const blankSql = await handleTasksPost({ title: "   " }, headers, envFor(), pair.sqlite.store, limiter(), NOW, IP);
    assert.deepEqual(blankSql, blankUp);
    assert.equal(blankSql.status, 400);

    const createdUp = await handleTasksPost(
      { title: "Pack the sample", notes: "Alpha", priority: "High", project: "Errands" },
      headers,
      envFor(),
      pair.upstash.store,
      limiter(),
      NOW,
      IP,
    );
    const createdSql = await handleTasksPost(
      { title: "Pack the sample", notes: "Alpha", priority: "High", project: "Errands" },
      headers,
      envFor(),
      pair.sqlite.store,
      limiter(),
      NOW,
      IP,
    );
    assert.deepEqual(createdSql, createdUp);
    assert.equal(createdSql.status, 201);
    const id = createdSql.body.id;

    const replayUp = await handleTasksPost({ title: "Other" }, headers, envFor(), pair.upstash.store, limiter(), NOW + 1, IP);
    const replaySql = await handleTasksPost({ title: "Other" }, headers, envFor(), pair.sqlite.store, limiter(), NOW + 1, IP);
    assert.deepEqual(replaySql, replayUp);
    assert.equal(replaySql.body.id, id);

    const listUrl = "http://127.0.0.1/api/tasks";
    const listedUp = await handleTasksGet(headers, envFor(), pair.upstash.store, limiter(), NOW + 1, IP, listUrl);
    const listedSql = await handleTasksGet(headers, envFor(), pair.sqlite.store, limiter(), NOW + 1, IP, listUrl);
    assert.deepEqual(listedSql, listedUp);
    assert.deepEqual(listedSql.body.map((task) => task.id), [id]);

    const searchUrl = "http://127.0.0.1/api/tasks?q=alpha";
    const foundUp = await handleTasksGet(headers, envFor(), pair.upstash.store, limiter(), NOW + 1, IP, searchUrl);
    const foundSql = await handleTasksGet(headers, envFor(), pair.sqlite.store, limiter(), NOW + 1, IP, searchUrl);
    assert.deepEqual(foundSql, foundUp);

    const gotUp = await handleTaskGet(id, headers, envFor(), pair.upstash.store, limiter(), NOW + 1, IP);
    const gotSql = await handleTaskGet(id, headers, envFor(), pair.sqlite.store, limiter(), NOW + 1, IP);
    assert.deepEqual(gotSql, gotUp);

    const patchedUp = await handleTaskPatch(id, { status: "Doing", notes: "Edited" }, headers, envFor(), pair.upstash.store, limiter(), NOW + 2, IP);
    const patchedSql = await handleTaskPatch(id, { status: "Doing", notes: "Edited" }, headers, envFor(), pair.sqlite.store, limiter(), NOW + 2, IP);
    assert.deepEqual(patchedSql, patchedUp);

    const doneUp = await handleTaskComplete(id, headers, envFor(), pair.upstash.store, limiter(), NOW + 3, IP);
    const doneSql = await handleTaskComplete(id, headers, envFor(), pair.sqlite.store, limiter(), NOW + 3, IP);
    assert.deepEqual(doneSql, doneUp);
    const doneAgainUp = await handleTaskComplete(id, headers, envFor(), pair.upstash.store, limiter(), NOW + 4, IP);
    const doneAgainSql = await handleTaskComplete(id, headers, envFor(), pair.sqlite.store, limiter(), NOW + 4, IP);
    assert.deepEqual(doneAgainSql, doneAgainUp);
    assert.equal(doneAgainSql.body.completedAt, doneSql.body.completedAt);

    const reopenUp = await handleTaskReopen(id, headers, envFor(), pair.upstash.store, limiter(), NOW + 5, IP);
    const reopenSql = await handleTaskReopen(id, headers, envFor(), pair.sqlite.store, limiter(), NOW + 5, IP);
    assert.deepEqual(reopenSql, reopenUp);
    const reopenAgainUp = await handleTaskReopen(id, headers, envFor(), pair.upstash.store, limiter(), NOW + 6, IP);
    const reopenAgainSql = await handleTaskReopen(id, headers, envFor(), pair.sqlite.store, limiter(), NOW + 6, IP);
    assert.deepEqual(reopenAgainSql, reopenAgainUp);

    const missingUp = await handleTaskGet("missing", headers, envFor(), pair.upstash.store, limiter(), NOW + 6, IP);
    const missingSql = await handleTaskGet("missing", headers, envFor(), pair.sqlite.store, limiter(), NOW + 6, IP);
    assert.deepEqual(missingSql, missingUp);
    assert.equal(missingSql.status, 404);

    const removedUp = await handleTaskDelete(id, headers, envFor(), pair.upstash.store, limiter(), NOW + 7, IP);
    const removedSql = await handleTaskDelete(id, headers, envFor(), pair.sqlite.store, limiter(), NOW + 7, IP);
    assert.deepEqual(removedSql, removedUp);
    const afterUp = await handleTaskGet(id, headers, envFor(), pair.upstash.store, limiter(), NOW + 8, IP);
    const afterSql = await handleTaskGet(id, headers, envFor(), pair.sqlite.store, limiter(), NOW + 8, IP);
    assert.deepEqual(afterSql, afterUp);
    assert.equal(afterSql.status, 404);

    const importedUp = await handleTasksPost(
      { title: "Imported", sourceId: "notion:page-1" },
      headersFor(pair.cookie, "notion-1"),
      envFor(),
      pair.upstash.store,
      limiter(),
      NOW + 9,
      IP,
    );
    const importedSql = await handleTasksPost(
      { title: "Imported", sourceId: "notion:page-1" },
      headersFor(pair.cookie, "notion-1"),
      envFor(),
      pair.sqlite.store,
      limiter(),
      NOW + 9,
      IP,
    );
    assert.deepEqual(importedSql, importedUp);
    const importedAgainUp = await handleTasksPost(
      { title: "Imported edited", sourceId: "notion:page-1" },
      headersFor(pair.cookie, "notion-2"),
      envFor(),
      pair.upstash.store,
      limiter(),
      NOW + 10,
      IP,
    );
    const importedAgainSql = await handleTasksPost(
      { title: "Imported edited", sourceId: "notion:page-1" },
      headersFor(pair.cookie, "notion-2"),
      envFor(),
      pair.sqlite.store,
      limiter(),
      NOW + 10,
      IP,
    );
    assert.deepEqual(importedAgainSql, importedAgainUp);
    assert.equal(importedAgainSql.body.id, importedSql.body.id);
  } finally {
    pair.client.close();
    pair.fake.stop();
    pair.base.stop();
  }
});

test("list routes count and clear sqlite tasks without reading redis task keys", async () => {
  const pair = await openPair();
  const limiter = () => createLimiter(60);
  const headers = headersFor(pair.cookie);
  const mark = pair.base.commands.length;
  try {
    const createdUp = await handleListsPost({ name: "Home", color: "#227777" }, headers, envFor(), pair.upstash.store, limiter(), NOW, IP);
    const createdSql = await handleListsPost({ name: "Home", color: "#227777" }, headers, envFor(), pair.sqlite.store, limiter(), NOW, IP);
    assert.equal(createdSql.status, 201);
    assert.equal(createdUp.status, 201);
    assert.equal(createdSql.body.name, createdUp.body.name);
    assert.equal(createdSql.body.count, 0);

    const taskUp = await handleTasksPost(
      { title: "On the list", project: createdUp.body.id },
      headersFor(pair.cookie, "list-task"),
      envFor(),
      pair.upstash.store,
      limiter(),
      NOW + 1,
      IP,
    );
    const taskSql = await handleTasksPost(
      { title: "On the list", project: createdSql.body.id },
      headersFor(pair.cookie, "list-task"),
      envFor(),
      pair.sqlite.store,
      limiter(),
      NOW + 1,
      IP,
    );
    assert.equal(taskSql.status, 201);
    assert.equal(taskUp.status, 201);

    const listsUp = await handleListsGet(headers, envFor(), pair.upstash.store, limiter(), NOW + 1, IP);
    const listsSql = await handleListsGet(headers, envFor(), pair.sqlite.store, limiter(), NOW + 1, IP);
    assert.equal(listsSql.status, 200);
    assert.equal(listsSql.body[0].count, 1);
    assert.equal(listsUp.body[0].count, 1);

    const renamedUp = await handleListPatch(createdUp.body.id, { name: "House" }, headers, envFor(), pair.upstash.store, limiter(), NOW + 2, IP);
    const renamedSql = await handleListPatch(createdSql.body.id, { name: "House" }, headers, envFor(), pair.sqlite.store, limiter(), NOW + 2, IP);
    assert.equal(renamedSql.status, 200);
    assert.equal(renamedSql.body.name, renamedUp.body.name);
    assert.equal(renamedSql.body.count, renamedUp.body.count);

    const removedUp = await handleListDelete(createdUp.body.id, headers, envFor(), pair.upstash.store, limiter(), NOW + 3, IP);
    const removedSql = await handleListDelete(createdSql.body.id, headers, envFor(), pair.sqlite.store, limiter(), NOW + 3, IP);
    assert.equal(removedSql.body.deleted, true);
    assert.equal(removedSql.body.moved, removedUp.body.moved);
    assert.equal(removedSql.body.id, createdSql.body.id);
    const clearedUp = await handleTaskGet(taskUp.body.id, headers, envFor(), pair.upstash.store, limiter(), NOW + 3, IP);
    const clearedSql = await handleTaskGet(taskSql.body.id, headers, envFor(), pair.sqlite.store, limiter(), NOW + 3, IP);
    assert.equal(clearedSql.body.project, null);
    assert.equal(clearedUp.body.project, null);

    assert.equal(pair.base.commands.slice(mark).some(taskKey), false);
    const session = await pair.sqlite.store.getSession(pair.sqlite.store ? "session-fixed-route" : "", NOW);
    assert.equal(session.owner, "owner-subject");
    assert.equal(pair.base.commands.some((args) => args.some((part) => typeof part === "string" && part.includes("joehub:sess:"))), true);
  } finally {
    pair.client.close();
    pair.fake.stop();
    pair.base.stop();
  }
});

test("an ingest write shows up on the normal tasks read", async () => {
  const pair = await openPair();
  const limiter = createLimiter(60);
  try {
    const token = await mintIngestToken(pair.client, "cato", new Date(NOW));
    const mark = pair.base.commands.length;
    const ingested = await handleIngest({
      entity: "tasks",
      rawBody: JSON.stringify({ title: "From the bot", notes: "Synthetic" }),
      headers: new Headers({ authorization: `Bearer ${token}`, "idempotency-key": "bot-1" }),
      env: envFor({ JOEHUB_BACKEND_TASKS: "sqlite" }),
      now: NOW,
      client: pair.client,
    });
    assert.equal(ingested.status, 201);
    const headers = headersFor(pair.cookie);
    const listed = await handleTasksGet(headers, envFor(), pair.sqlite.store, limiter, NOW, IP, "http://127.0.0.1/api/tasks");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.some((task) => task.id === ingested.body.id && task.title === "From the bot"), true);
    const fetched = await handleTaskGet(ingested.body.id, headers, envFor(), pair.sqlite.store, limiter, NOW, IP);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.notes, "Synthetic");
    assert.equal(pair.base.commands.slice(mark).some(taskKey), false);
  } finally {
    pair.client.close();
    pair.fake.stop();
    pair.base.stop();
  }
});
