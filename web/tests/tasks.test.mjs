import assert from "node:assert/strict";
import test from "node:test";
import { createStore, login } from "../lib/sessions.mjs";
import { handleGet, handleTasksGet, handleTasksPost } from "../lib/api.mjs";
import { createLimiter } from "../lib/ratelimit.mjs";
import { createUpstashStore } from "../lib/store-upstash.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";
import { detroitCalendarDate } from "../lib/detroit-date.mjs";
import {
  createMemoryBackend,
  IDEMPOTENCY_TTL_MS,
  installMemoryTasks,
  performCreate,
  performPatch,
  unfinishedNewestFirst,
  validateTaskCreate,
  validateTaskPatch,
} from "../lib/tasks.mjs";
import { handleTaskGet, handleTaskPatch } from "../lib/api.mjs";

const devEnv = { JOEHUB_DEV_AUTH: "1", JOEHUB_SESSION_SECRET: "tasks-unit-secret-value", NODE_ENV: "development" };

test("a blank title is rejected and optional fields can be empty or set", () => {
  assert.equal(validateTaskCreate({ title: "   " }).ok, false);
  assert.equal(validateTaskCreate({ title: "   " }).field, "title");
  assert.equal(validateTaskCreate({ title: 4 }).field, "title");
  assert.equal(validateTaskCreate({ title: "Keep", status: "Done" }).ok, false);
  const blank = validateTaskCreate({ title: "  Keep  ", notes: "  ", dueDate: "", priority: "", project: "  " });
  assert.equal(blank.ok, true);
  assert.equal(blank.title, "Keep");
  assert.equal(blank.notes, "");
  assert.equal(blank.dueDate, "");
  assert.equal(blank.status, "To do");
  const full = validateTaskCreate({
    title: "Pack",
    notes: " A note ",
    dueDate: "2026-11-20",
    priority: "High",
    status: "Blocked",
    project: " Errands ",
  });
  assert.equal(full.ok, true);
  assert.equal(full.notes, "A note");
  assert.equal(full.dueDate, "2026-11-20");
  assert.equal(full.priority, "High");
  assert.equal(full.status, "Blocked");
  assert.equal(full.project, "Errands");
  assert.equal(validateTaskCreate({ title: "Pack", dueDate: "2026-02-31" }).ok, false);
});

test("unfinished tasks sort newest first and keep undated ones", () => {
  const rows = unfinishedNewestFirst([
    { id: "old", title: "old", status: "To do", createdAt: 1, updatedAt: 1 },
    { id: "done", title: "done", status: "Done", createdAt: 9, updatedAt: 9 },
    { id: "new", title: "new", status: "Doing", createdAt: 3, updatedAt: 3 },
    { id: "undated", title: "undated", status: "Blocked", createdAt: 2, updatedAt: 2 },
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["new", "undated", "old"]);
  assert.equal(rows.find((row) => row.id === "undated").dueDate, undefined);
});

test("one idempotency key creates one task, including after a failed save", async () => {
  const backend = createMemoryBackend();
  const now = 1_000_000;
  const first = await performCreate(backend, { title: "Once" }, "key-1", now, () => "id-1");
  const second = await performCreate(backend, { title: "Twice" }, "key-1", now + 5, () => "id-2");
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.body.id, "id-1");
  assert.equal(second.body.title, "Once");
  assert.equal(backend.tasks.size, 1);
  assert.equal((await backend.readIdem("key-1", now + IDEMPOTENCY_TTL_MS - 1)).body.id, "id-1");
  assert.equal(await backend.readIdem("key-1", now + IDEMPOTENCY_TTL_MS), null);

  const flaky = createMemoryBackend();
  let fail = true;
  const put = flaky.putTask.bind(flaky);
  flaky.putTask = async (task) => {
    if (fail) {
      fail = false;
      throw new Error("unavailable");
    }
    return put(task);
  };
  await assert.rejects(() => performCreate(flaky, { title: "Retry me" }, "retry", now, () => "id-a"));
  const retried = await performCreate(flaky, { title: "Retry me" }, "retry", now + 20, () => "id-b");
  assert.equal(retried.status, 201);
  assert.equal(retried.body.id, "id-b");
  assert.equal(flaky.tasks.size, 1);

  const raced = createMemoryBackend();
  const [left, right] = await Promise.all([
    performCreate(raced, { title: "Race" }, "race", now, () => "id-left"),
    performCreate(raced, { title: "Race" }, "race", now, () => "id-right"),
  ]);
  assert.equal(left.body.id, right.body.id);
  assert.equal(raced.tasks.size, 1);
  const listed = await raced.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].dueDate, undefined);
});

test("task routes require a session and keep a blank title", async () => {
  const store = installMemoryTasks(createStore());
  const limiter = createLimiter(20);
  const now = 50_000;
  const denied = await handleTasksGet({ get: () => "" }, devEnv, store, limiter, now, "ip");
  assert.equal(denied.status, 401);
  const logged = login({ username: "synthetic", password: "synthetic" }, devEnv, store, now);
  const headers = { get: (name) => (name === "cookie" ? `joehub_session=${logged.cookie}` : name === "idempotency-key" ? "route-key" : "") };
  const blank = await handleTasksPost({ title: "  " }, headers, devEnv, store, limiter, now, "ip");
  assert.equal(blank.status, 400);
  assert.equal(blank.body.field, "title");
  const created = await handleTasksPost({ title: "Route task" }, headers, devEnv, store, limiter, now + 1, "ip");
  assert.equal(created.status, 201);
  const again = await handleTasksPost({ title: "Route task" }, headers, devEnv, store, limiter, now + 2, "ip");
  assert.equal(again.body.id, created.body.id);
  const listed = await handleTasksGet(headers, devEnv, store, limiter, now + 3, "ip");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.filter((task) => task.id === created.body.id).length, 1);
  assert.equal(listed.body[0].id, created.body.id);
});

test("a failed idempotency write keeps the created task for a retry", async () => {
  const backend = createMemoryBackend();
  const now = 1_000_000;
  backend.writeIdem = async () => {
    throw new Error("idempotency unavailable");
  };
  await assert.rejects(() => performCreate(backend, { title: "Once" }, "key-fail", now, () => "id-kept"));
  assert.equal(backend.tasks.size, 1);
  assert.equal(backend.tasks.get("id-kept").title, "Once");
  const retried = await performCreate(backend, { title: "Different" }, "key-fail", now + 10, () => "id-other");
  assert.equal(retried.status, 201);
  assert.equal(retried.body.id, "id-kept");
  assert.equal(retried.body.title, "Once");
  assert.equal(backend.tasks.size, 1);
});

test("upstash returns the stored task when the idempotency write fails", async () => {
  const fake = await startFakeUpstash();
  let failed = false;
  const store = createUpstashStore({
    url: fake.url,
    token: fake.token,
    fetchImpl: async (url, init) => {
      const args = JSON.parse(init.body);
      const responseWrite =
        args[0] === "SET" && String(args[1]).includes(":idem:") && String(args[2]).includes('"title":"Keep me"');
      if (responseWrite && !failed) {
        failed = true;
        return new Response(JSON.stringify({ error: "unavailable" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return fetch(url, init);
    },
  });
  try {
    await assert.rejects(() => store.createTask({ title: "Keep me" }, "idem-fail", 2_000_000_000_000));
    const retried = await store.createTask({ title: "Other" }, "idem-fail", 2_000_000_000_100);
    assert.equal(retried.status, 201);
    assert.equal(retried.body.title, "Keep me");
    const listed = await store.listUnfinishedTasks();
    assert.equal(listed.filter((task) => task.id === retried.body.id).length, 1);
    assert.equal(listed.filter((task) => task.title === "Other").length, 0);
  } finally {
    fake.stop();
  }
});

test("tasks share the api rate limiter", async () => {
  const store = installMemoryTasks(createStore());
  const limiter = createLimiter(2);
  const now = 80_000;
  const logged = login({ username: "synthetic", password: "synthetic" }, devEnv, store, now);
  const headers = { get: (name) => (name === "cookie" ? `joehub_session=${logged.cookie}` : "") };
  assert.equal((await handleTasksGet(headers, devEnv, store, limiter, now, "ip")).status, 200);
  assert.equal((await handleGet("transactions", headers, devEnv, store, limiter, now, "ip")).status, 200);
  const blocked = await handleTasksPost({ title: "Limited" }, headers, devEnv, store, limiter, now, "ip");
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.body, { detail: "rate limit" });
});

test("a patch validates fields and today is the Detroit calendar day", () => {
  const afterUtcMidnight = Date.parse("2026-11-10T00:30:00.000Z");
  const beforeDetroitMidnight = Date.parse("2026-11-10T04:59:00.000Z");
  const afterDetroitMidnight = Date.parse("2026-11-10T05:01:00.000Z");
  assert.equal(detroitCalendarDate(afterUtcMidnight), "2026-11-09");
  assert.equal(detroitCalendarDate(beforeDetroitMidnight), "2026-11-09");
  assert.equal(detroitCalendarDate(afterDetroitMidnight), "2026-11-10");
  const today = validateTaskPatch({ dueDate: "today" }, afterUtcMidnight);
  assert.equal(today.ok, true);
  assert.equal(today.patch.dueDate, "2026-11-09");
  const rolled = validateTaskPatch({ dueDate: "today" }, afterDetroitMidnight);
  assert.equal(rolled.patch.dueDate, "2026-11-10");
  assert.equal(validateTaskPatch({ title: "  " }, afterUtcMidnight).field, "title");
  assert.equal(validateTaskPatch({ title: null }, afterUtcMidnight).ok, false);
  assert.equal(validateTaskPatch({ status: "Done" }, afterUtcMidnight).field, "status");
  assert.equal(validateTaskPatch({ notes: null, dueDate: null, priority: null, project: null }, afterUtcMidnight).ok, true);
  assert.equal(validateTaskPatch({ dueDate: "2026-02-31" }, afterUtcMidnight).ok, false);
});

test("a patch persists, clears optional fields, and a failed write keeps the stored task", async () => {
  const backend = createMemoryBackend();
  const now = 1_700_000_000_000;
  const created = await performCreate(
    backend,
    { title: "Edit me", notes: "Keep", dueDate: "2026-11-20", priority: "High", status: "Doing", project: "Home" },
    "",
    now,
    () => "id-edit",
  );
  assert.equal(created.status, 201);
  const patched = await performPatch(
    backend,
    "id-edit",
    { title: "Edited", notes: null, dueDate: null, priority: null, project: null, status: "Blocked" },
    now + 40,
  );
  assert.equal(patched.status, 200);
  assert.equal(patched.body.title, "Edited");
  assert.equal(patched.body.status, "Blocked");
  assert.equal(patched.body.notes, undefined);
  assert.equal(patched.body.dueDate, undefined);
  assert.equal(patched.body.priority, undefined);
  assert.equal(patched.body.project, undefined);
  assert.equal(patched.body.createdAt, now);
  assert.ok(patched.body.updatedAt > created.body.updatedAt);
  const blank = await performPatch(backend, "id-edit", { title: "   " }, now + 50);
  assert.equal(blank.status, 400);
  assert.equal(blank.body.field, "title");
  assert.equal(backend.tasks.get("id-edit").title, "Edited");
  const done = await performPatch(backend, "id-edit", { status: "Done" }, now + 60);
  assert.equal(done.status, 400);
  assert.equal(done.body.field, "status");
  assert.equal(backend.tasks.get("id-edit").status, "Blocked");
  const missing = await performPatch(backend, "missing-task", { title: "Nope" }, now + 70);
  assert.equal(missing.status, 404);
  const today = await performPatch(backend, "id-edit", { dueDate: "today" }, Date.parse("2026-11-10T00:30:00.000Z"));
  assert.equal(today.body.dueDate, "2026-11-09");

  const before = structuredClone(backend.tasks.get("id-edit"));
  backend.putTask = async () => {
    throw new Error("unavailable");
  };
  await assert.rejects(() => performPatch(backend, "id-edit", { title: "Should not stick" }, now + 80));
  assert.deepEqual(backend.tasks.get("id-edit"), before);
});

test("task get and patch require a session and share the api limiter", async () => {
  const store = installMemoryTasks(createStore());
  const limiter = createLimiter(2);
  const now = 90_000;
  const headers = { get: () => "" };
  assert.equal((await handleTaskGet("id-edit", headers, devEnv, store, limiter, now, "other")).status, 401);
  const logged = login({ username: "synthetic", password: "synthetic" }, devEnv, store, now);
  const session = { get: (name) => (name === "cookie" ? `joehub_session=${logged.cookie}` : "") };
  const created = await store.createTask({ title: "Limited edit" }, "", now);
  assert.equal((await handleTaskGet(created.body.id, session, devEnv, store, limiter, now, "ip")).status, 200);
  const changed = await handleTaskPatch(created.body.id, { title: "Limited edited" }, session, devEnv, store, limiter, now + 5, "ip");
  assert.equal(changed.status, 200);
  assert.ok(changed.body.updatedAt > created.body.updatedAt);
  const blocked = await handleTaskPatch(created.body.id, { title: "Too many" }, session, devEnv, store, limiter, now + 6, "ip");
  assert.equal(blocked.status, 429);
  assert.equal((await store.getTask(created.body.id)).title, "Limited edited");
});
