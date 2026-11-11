import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { reservePort, spawnLogged, stopProcess, waitForHttp } from "./support/harness.mjs";
import { detroitCalendarDate } from "../lib/detroit-date.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SECRET = "tasks-http-secret-value";

function cookieValue(response) {
  const rows = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const raw = rows.find((row) => row.startsWith("joehub_session=")) || response.headers.get("set-cookie") || "";
  return raw.split(";", 1)[0].slice("joehub_session=".length);
}

test("task api requires a session, persists a create, and dedupes an idempotency key", { timeout: 120000 }, async () => {
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const started = spawnLogged(["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME || "/tmp",
      TMPDIR: process.env.TMPDIR || "/tmp",
      LANG: "C.UTF-8",
      NODE_ENV: "development",
      JOEHUB_DEV_AUTH: "1",
      JOEHUB_SESSION_SECRET: SECRET,
    },
  });
  try {
    await waitForHttp(`${base}/api/tasks`, {
      child: started.child,
      log: started.log,
      accept: (response) => response.status === 401,
    });
    assert.equal((await fetch(`${base}/api/tasks`)).status, 401);
    assert.equal((await fetch(`${base}/api/tasks/missing-task`)).status, 401);
    assert.equal(
      (
        await fetch(`${base}/api/tasks/missing-task`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Nope" }),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${base}/api/tasks`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Nope" }),
        })
      ).status,
      401,
    );

    const logged = await fetch(`${base}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "tasks-http" }),
    });
    assert.equal(logged.status, 200);
    const cookie = `joehub_session=${cookieValue(logged)}`;
    const auth = { cookie, "content-type": "application/json" };

    const blank = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ title: "   " }),
    });
    assert.equal(blank.status, 400);
    assert.equal((await blank.json()).field, "title");

    const other = await fetch(`${base}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "tasks-http-2" }),
    });
    const secondCookie = `joehub_session=${cookieValue(other)}`;

    const payload = {
      title: "Call the sample library",
      notes: "Synthetic note",
      dueDate: "2026-11-21",
      priority: "Medium",
      status: "Doing",
      project: "Home",
    };
    const key = "http-idem-1";
    const first = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { ...auth, "idempotency-key": key },
      body: JSON.stringify(payload),
    });
    const second = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { ...auth, "idempotency-key": key },
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 201, await first.clone().text());
    assert.equal(second.status, 201);
    const created = await first.json();
    const replay = await second.json();
    assert.equal(replay.id, created.id);
    assert.equal(created.title, "Call the sample library");
    assert.equal(created.notes, "Synthetic note");
    assert.equal(created.dueDate, "2026-11-21");
    assert.equal(created.priority, "Medium");
    assert.equal(created.status, "Doing");
    assert.equal(created.project, "Home");

    await new Promise((resolve) => setTimeout(resolve, 5));
    const undated = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { ...auth, "idempotency-key": "http-idem-2" },
      body: JSON.stringify({ title: "Undated sample" }),
    });
    assert.equal(undated.status, 201);
    const undatedBody = await undated.json();
    assert.equal(undatedBody.dueDate, undefined);
    assert.equal(undatedBody.status, "To do");

    const listed = await fetch(`${base}/api/tasks`, { headers: { cookie: secondCookie } });
    assert.equal(listed.status, 200);
    const tasks = await listed.json();
    assert.equal(tasks.filter((task) => task.id === created.id).length, 1);
    assert.equal(tasks.filter((task) => task.title === "Undated sample").length, 1);
    assert.equal(tasks[0].id, undatedBody.id);
    assert.ok(tasks[0].createdAt >= tasks[1].createdAt);
    const done = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ title: "Finished sample", status: "Done" }),
    });
    assert.equal(done.status, 400);

    const edited = await fetch(`${base}/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ title: "Call the sample desk", status: "Blocked" }),
    });
    assert.equal(edited.status, 200, await edited.clone().text());
    const editedBody = await edited.json();
    assert.equal(editedBody.title, "Call the sample desk");
    assert.equal(editedBody.status, "Blocked");
    assert.equal(editedBody.notes, "Synthetic note");
    assert.ok(editedBody.updatedAt > created.updatedAt);
    assert.equal(editedBody.createdAt, created.createdAt);
    const cleared = await fetch(`${base}/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ notes: null, dueDate: null, priority: null, project: null }),
    });
    assert.equal(cleared.status, 200);
    const clearedBody = await cleared.json();
    assert.equal(clearedBody.notes, undefined);
    assert.equal(clearedBody.dueDate, undefined);
    assert.equal(clearedBody.priority, undefined);
    assert.equal(clearedBody.project, undefined);
    const blankEdit = await fetch(`${base}/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ title: "   " }),
    });
    assert.equal(blankEdit.status, 400);
    assert.equal((await blankEdit.json()).field, "title");
    const locked = await fetch(`${base}/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ id: "other-id", createdAt: 1, updatedAt: 1, completedAt: 1, mystery: true }),
    });
    assert.equal(locked.status, 400);
    const lockedBody = await locked.json();
    assert.equal(lockedBody.field, "id");
    assert.match(lockedBody.detail, /id/);
    const missing = await fetch(`${base}/api/tasks/missing-task`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ title: "Nope" }),
    });
    assert.equal(missing.status, 404);
    const today = await fetch(`${base}/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ dueDate: "today" }),
    });
    assert.equal(today.status, 200);
    const todayBody = await today.json();
    assert.equal(todayBody.dueDate, detroitCalendarDate(Date.now()));
    const fetched = await fetch(`${base}/api/tasks/${created.id}`, { headers: { cookie } });
    assert.equal(fetched.status, 200);
    const stored = await fetched.json();
    assert.equal(stored.title, "Call the sample desk");
    assert.equal(stored.status, "Blocked");
    assert.equal(stored.dueDate, todayBody.dueDate);
    assert.equal(stored.notes, undefined);
    const doneEdit = await fetch(`${base}/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ status: "Done" }),
    });
    assert.equal(doneEdit.status, 200);
    const doneBody = await doneEdit.json();
    assert.equal(doneBody.status, "Done");
    assert.equal(typeof doneBody.completedAt, "number");
    const unfinished = await fetch(`${base}/api/tasks`, { headers: { cookie } });
    assert.equal((await unfinished.json()).some((task) => task.id === created.id), false);
  } finally {
    await stopProcess(started.child);
  }
});
