import assert from "node:assert/strict";
import test from "node:test";
import { createStore, login } from "../lib/sessions.mjs";
import { handleTasksGet, handleTasksPost } from "../lib/api.mjs";
import { createLimiter } from "../lib/ratelimit.mjs";
import {
  createMemoryBackend,
  IDEMPOTENCY_TTL_MS,
  installMemoryTasks,
  performCreate,
  unfinishedNewestFirst,
  validateTaskCreate,
} from "../lib/tasks.mjs";

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
