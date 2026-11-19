import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import {
  handleGroceryClear,
  handleGroceryGet,
  handleGroceryItemCheck,
  handleGroceryItemDelete,
  handleGroceryItemGet,
  handleGroceryItemPatch,
  handleGroceryItemUncheck,
  handleGroceryPost,
} from "../lib/api.mjs";
import { createLimiter } from "../lib/ratelimit.mjs";
import { seal } from "../lib/sessions.mjs";
import { createRuntime } from "../lib/store.mjs";
import { migrateLibsql } from "../scripts/libsql-migrate.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-19T12:10:00.000Z");
const SECRET = "grocery-route-secret-value";
const IP = "203.0.113.18";

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

function groceryKey(command) {
  return command.some((part) => typeof part === "string" && part.includes("joehub:grocery"));
}

async function openPair() {
  const fake = await startFakeUpstash();
  const base = await startFakeUpstash();
  const client = createClient({ url: ":memory:" });
  await migrateLibsql({ client, url: ":memory:", test: true });
  const session = {
    id: "session-grocery-route",
    deviceId: "device-grocery-route",
    createdAt: NOW,
    expiresAt: NOW + 14 * 24 * 60 * 60 * 1000,
    revoked: false,
    owner: "owner-subject",
    label: "browser",
  };
  const upstash = createRuntime(envFor({ UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token }));
  const sqlite = createRuntime(
    envFor({
      UPSTASH_REDIS_REST_URL: base.url,
      UPSTASH_REDIS_REST_TOKEN: base.token,
      JOEHUB_BACKEND_GROCERY: "sqlite",
      JOEHUB_LIBSQL_URL: "libsql://example.turso.io",
    }),
    { groceryClient: client },
  );
  await upstash.store.putSession(session, NOW);
  await sqlite.store.putSession(session, NOW);
  return { fake, base, client, upstash, sqlite, cookie: seal(SECRET, session.id) };
}

test("grocery routes return the same responses on sqlite and write no grocery keys", async () => {
  const pair = await openPair();
  const limiter = () => createLimiter(60);
  try {
    const anonymous = headersFor("");
    const upAnon = await handleGroceryGet(anonymous, envFor(), pair.upstash.store, limiter(), NOW, IP);
    const sqlAnon = await handleGroceryGet(anonymous, envFor(), pair.sqlite.store, limiter(), NOW, IP);
    assert.deepEqual(sqlAnon, upAnon);
    assert.equal(sqlAnon.status, 401);

    const headers = headersFor(pair.cookie, "route-1");
    const blankUp = await handleGroceryPost({ name: "  " }, headers, envFor(), pair.upstash.store, limiter(), NOW, IP);
    const blankSql = await handleGroceryPost({ name: "  " }, headers, envFor(), pair.sqlite.store, limiter(), NOW, IP);
    assert.deepEqual(blankSql, blankUp);
    assert.equal(blankSql.status, 400);

    const mark = pair.base.commands.length;
    const createdUp = await handleGroceryPost(
      { name: "Synthetic oats", quantity: "1 bag", section: "Pantry", sourceId: "notion:route-oats" },
      headers,
      envFor(),
      pair.upstash.store,
      limiter(),
      NOW,
      IP,
    );
    const createdSql = await handleGroceryPost(
      { name: "Synthetic oats", quantity: "1 bag", section: "Pantry", sourceId: "notion:route-oats" },
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

    const replaySql = await handleGroceryPost({ name: "Other" }, headers, envFor(), pair.sqlite.store, limiter(), NOW + 1, IP);
    const replayUp = await handleGroceryPost({ name: "Other" }, headers, envFor(), pair.upstash.store, limiter(), NOW + 1, IP);
    assert.deepEqual(replaySql, replayUp);
    assert.equal(replaySql.body.id, id);

    const patchedSql = await handleGroceryItemPatch(id, { quantity: "2 bags", notes: "Synthetic note" }, headersFor(pair.cookie), envFor(), pair.sqlite.store, limiter(), NOW + 2, IP);
    const patchedUp = await handleGroceryItemPatch(id, { quantity: "2 bags", notes: "Synthetic note" }, headersFor(pair.cookie), envFor(), pair.upstash.store, limiter(), NOW + 2, IP);
    assert.deepEqual(patchedSql, patchedUp);

    const gotSql = await handleGroceryItemGet(id, headersFor(pair.cookie), envFor(), pair.sqlite.store, limiter(), NOW + 3, IP);
    const gotUp = await handleGroceryItemGet(id, headersFor(pair.cookie), envFor(), pair.upstash.store, limiter(), NOW + 3, IP);
    assert.deepEqual(gotSql, gotUp);

    const checkedSql = await handleGroceryItemCheck(id, headersFor(pair.cookie), envFor(), pair.sqlite.store, limiter(), NOW + 4, IP);
    const checkedUp = await handleGroceryItemCheck(id, headersFor(pair.cookie), envFor(), pair.upstash.store, limiter(), NOW + 4, IP);
    assert.deepEqual(checkedSql, checkedUp);
    const againSql = await handleGroceryItemCheck(id, headersFor(pair.cookie), envFor(), pair.sqlite.store, limiter(), NOW + 5, IP);
    const againUp = await handleGroceryItemCheck(id, headersFor(pair.cookie), envFor(), pair.upstash.store, limiter(), NOW + 5, IP);
    assert.deepEqual(againSql, againUp);

    const openSql = await handleGroceryItemUncheck(id, headersFor(pair.cookie), envFor(), pair.sqlite.store, limiter(), NOW + 6, IP);
    const openUp = await handleGroceryItemUncheck(id, headersFor(pair.cookie), envFor(), pair.upstash.store, limiter(), NOW + 6, IP);
    assert.deepEqual(openSql, openUp);

    await handleGroceryItemCheck(id, headersFor(pair.cookie), envFor(), pair.sqlite.store, limiter(), NOW + 7, IP);
    await handleGroceryItemCheck(id, headersFor(pair.cookie), envFor(), pair.upstash.store, limiter(), NOW + 7, IP);
    const clearedSql = await handleGroceryClear(headersFor(pair.cookie), envFor(), pair.sqlite.store, limiter(), NOW + 8, IP);
    const clearedUp = await handleGroceryClear(headersFor(pair.cookie), envFor(), pair.upstash.store, limiter(), NOW + 8, IP);
    assert.deepEqual(clearedSql, clearedUp);

    const listedSql = await handleGroceryGet(headersFor(pair.cookie), envFor(), pair.sqlite.store, limiter(), NOW + 9, IP);
    const listedUp = await handleGroceryGet(headersFor(pair.cookie), envFor(), pair.upstash.store, limiter(), NOW + 9, IP);
    assert.deepEqual(listedSql, listedUp);

    const secondSql = await handleGroceryPost(
      { name: "Synthetic towels", quantity: "2", sourceId: "notion:route-towels" },
      headersFor(pair.cookie, "route-2"),
      envFor(),
      pair.sqlite.store,
      limiter(),
      NOW + 10,
      IP,
    );
    const secondUp = await handleGroceryPost(
      { name: "Synthetic towels", quantity: "2", sourceId: "notion:route-towels" },
      headersFor(pair.cookie, "route-2"),
      envFor(),
      pair.upstash.store,
      limiter(),
      NOW + 10,
      IP,
    );
    assert.deepEqual(secondSql, secondUp);
    const editedSql = await handleGroceryPost(
      { name: "Synthetic towels", quantity: "3", sourceId: "notion:route-towels" },
      headersFor(pair.cookie, "route-3"),
      envFor(),
      pair.sqlite.store,
      limiter(),
      NOW + 11,
      IP,
    );
    const editedUp = await handleGroceryPost(
      { name: "Synthetic towels", quantity: "3", sourceId: "notion:route-towels" },
      headersFor(pair.cookie, "route-3"),
      envFor(),
      pair.upstash.store,
      limiter(),
      NOW + 11,
      IP,
    );
    assert.deepEqual(editedSql, editedUp);
    assert.equal(editedSql.body.id, secondSql.body.id);

    const removedSql = await handleGroceryItemDelete(secondSql.body.id, headersFor(pair.cookie), envFor(), pair.sqlite.store, limiter(), NOW + 12, IP);
    const removedUp = await handleGroceryItemDelete(secondUp.body.id, headersFor(pair.cookie), envFor(), pair.upstash.store, limiter(), NOW + 12, IP);
    assert.deepEqual(removedSql, removedUp);
    assert.equal(removedSql.status, 200);
    const missingSql = await handleGroceryItemGet(id, headersFor(pair.cookie), envFor(), pair.sqlite.store, limiter(), NOW + 11, IP);
    const missingUp = await handleGroceryItemGet(id, headersFor(pair.cookie), envFor(), pair.upstash.store, limiter(), NOW + 11, IP);
    assert.deepEqual(missingSql, missingUp);
    assert.equal(missingSql.status, 404);

    assert.equal(pair.base.commands.slice(mark).some(groceryKey), false);
  } finally {
    pair.client.close();
    pair.fake.stop();
    pair.base.stop();
  }
});
