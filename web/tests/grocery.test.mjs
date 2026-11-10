import assert from "node:assert/strict";
import test from "node:test";
import { createStore, login } from "../lib/sessions.mjs";
import { handleGroceryGet, handleGroceryItemDelete, handleGroceryItemGet, handleGroceryItemPatch, handleGroceryPost } from "../lib/api.mjs";
import { createLimiter } from "../lib/ratelimit.mjs";
import { createUpstashStore, StoreError } from "../lib/store-upstash.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";
import {
  createMemoryBackend,
  existingName,
  groupGrocery,
  installMemoryGrocery,
  itemIdForKey,
  performCreate,
  performDelete,
  performPatch,
  SAMPLE_GROCERY,
  sectionSuggestions,
  validateGroceryCreate,
  validateGroceryPatch,
} from "../lib/grocery.mjs";

const devEnv = { JOEHUB_DEV_AUTH: "1", JOEHUB_SESSION_SECRET: "grocery-unit-secret-value", NODE_ENV: "development" };

test("a blank name, invalid quantity, and unknown field are rejected", () => {
  assert.equal(validateGroceryCreate({ name: "   " }).field, "name");
  assert.equal(validateGroceryCreate({ name: "   " }).detail, "Enter a name.");
  assert.equal(validateGroceryCreate(null).detail, "Item must be an object");
  assert.equal(validateGroceryCreate({ name: "Apples", checked: false }).detail, "checked isn't accepted.");
  for (const quantity of ["-1", "-2 bags", "---", "??", "."]) {
    const rejected = validateGroceryCreate({ name: "Apples", quantity });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.field, "quantity");
    assert.equal(rejected.detail, "Enter a valid quantity.");
  }
  for (const quantity of ["6", "1 carton", "1 dozen", "1 bag", "8 cans", "2", "1.5 lb", "a bunch", "  ", ""]) {
    const parsed = validateGroceryCreate({ name: " Apples ", quantity, notes: "  ", section: "  " });
    assert.equal(parsed.ok, true, quantity);
    assert.equal(parsed.name, "Apples");
  }
  const full = validateGroceryCreate({
    name: " Oat milk ",
    quantity: " 1 carton ",
    notes: " Barista style ",
    section: " Dairy ",
  });
  assert.equal(full.quantity, "1 carton");
  assert.equal(full.notes, "Barista style");
  assert.equal(full.section, "Dairy");
});

test("sections follow first-seen order, with No section then Checked", () => {
  const groups = groupGrocery([
    { id: "b", name: "Oats", section: "Produce", checked: false, createdAt: 20, updatedAt: 20 },
    { id: "a", name: "Bananas", section: "Produce", checked: false, createdAt: 10, updatedAt: 10 },
    { id: "c", name: "Milk", section: "Dairy", notes: "Cold", checked: false, createdAt: 30, updatedAt: 30 },
    { id: "d", name: "Towels", quantity: "2", checked: false, createdAt: 5, updatedAt: 5 },
    { id: "e", name: "Bread", section: "Bakery", checked: true, checkedAt: 40, createdAt: 1, updatedAt: 40 },
  ]);
  assert.deepEqual(
    groups.map((group) => [group.label, group.items.map((item) => item.name)]),
    [
      ["Produce", ["Bananas", "Oats"]],
      ["Dairy", ["Milk"]],
      ["No section", ["Towels"]],
      ["Checked", ["Bread"]],
    ],
  );
  assert.equal(existingName(groups.flatMap((group) => group.items), " oat milk "), "");
  assert.equal(existingName([{ id: "1", name: "Oat milk", createdAt: 2 }, { id: "2", name: "oat milk", createdAt: 1 }], "OAT MILK"), "oat milk");
});

test("one idempotency key stores one item and a repeat name does not block another", async () => {
  const backend = createMemoryBackend();
  const now = 5_000;
  const first = await performCreate(backend, { name: "Oat milk", quantity: "1 carton" }, "key-1", now, () => "id-1", "scope");
  const replay = await performCreate(backend, { name: "Other" }, "key-1", now + 5, () => "id-2", "scope");
  assert.equal(first.status, 201);
  assert.equal(replay.body.id, "id-1");
  assert.equal(replay.body.name, "Oat milk");
  const second = await performCreate(backend, { name: "Oat milk", quantity: "a bunch" }, "key-2", now + 10);
  assert.equal(second.status, 201);
  assert.notEqual(second.body.id, first.body.id);
  const listed = await backend.list();
  assert.equal(listed.filter((item) => item.name === "Oat milk").length, 2);
  const again = await backend.list();
  assert.deepEqual(again.map((item) => item.id), listed.map((item) => item.id));
  const stable = await itemIdForKey("scope", "key-1");
  assert.equal(await itemIdForKey("scope", "key-1"), stable);
  assert.notEqual(await itemIdForKey("scope", "key-2"), stable);
});

test("the sample list is seeded once in memory and on upstash", async () => {
  const seeded = installMemoryGrocery(createStore(), { seed: true });
  const first = await seeded.listGrocery();
  const second = await seeded.listGrocery();
  assert.deepEqual(first.map((item) => item.name), SAMPLE_GROCERY.map((item) => item.name));
  assert.equal(second.length, first.length);
  const plain = installMemoryGrocery(createStore(), { seed: false });
  assert.deepEqual(await plain.listGrocery(), []);

  const fake = await startFakeUpstash();
  try {
    const store = createUpstashStore({ url: fake.url, token: fake.token });
    const now = 1_700_000_000_000;
    const listed = await store.listGrocery(now);
    assert.equal(listed.length, 5);
    await store.listGrocery(now);
    const flags = fake.commands.filter((args) => args[0] === "SET" && args[1] === "joehub:grocery:seeded");
    assert.equal(flags.length, 1);
    const created = await store.createGrocery({ name: "Apples", section: "Produce" }, "once", now + 10, "owner");
    const replay = await store.createGrocery({ name: "Pears" }, "once", now + 20, "owner");
    assert.equal(created.status, 201);
    assert.equal(replay.body.id, created.body.id);
    const after = await store.listGrocery(now + 30);
    assert.equal(after.filter((item) => item.name === "Apples").length, 1);
    const idem = fake.commands.find((args) => args[0] === "SET" && String(args[1]).includes("grocery:item:idem:") && String(args[2]).includes("Apples"));
    assert.ok(idem);
    assert.ok(idem.includes("86400"));
  } finally {
    fake.stop();
  }
});

test("grocery routes require a session and return 400 or 503", async () => {
  const store = installMemoryGrocery(createStore());
  const limiter = createLimiter(60);
  const now = Date.now();
  const anon = { get: () => "" };
  assert.equal((await handleGroceryGet(anon, devEnv, store, limiter, now, "ip")).status, 401);
  assert.equal((await handleGroceryPost({ name: "Nope" }, anon, devEnv, store, limiter, now, "ip")).status, 401);
  assert.equal((await handleGroceryItemGet("missing-item", anon, devEnv, store, limiter, now, "ip")).status, 401);

  const logged = await login({ username: "synthetic", password: "synthetic", device_label: "grocery" }, devEnv, store, now);
  const headers = {
    get: (name) => (name === "cookie" ? `joehub_session=${logged.cookie}` : name === "idempotency-key" ? "route-key" : ""),
  };
  const blank = await handleGroceryPost({ name: " " }, headers, devEnv, store, limiter, now, "ip");
  assert.equal(blank.status, 400);
  assert.equal(blank.body.field, "name");
  const badQty = await handleGroceryPost({ name: "Apples", quantity: "-1" }, headers, devEnv, store, limiter, now + 1, "ip");
  assert.equal(badQty.status, 400);
  assert.equal(badQty.body.detail, "Enter a valid quantity.");
  const created = await handleGroceryPost({ name: "Apples", section: "Produce" }, headers, devEnv, store, limiter, now + 2, "ip");
  assert.equal(created.status, 201);
  const replay = await handleGroceryPost({ name: "Other" }, headers, devEnv, store, limiter, now + 3, "ip");
  assert.equal(replay.body.id, created.body.id);
  const fetched = await handleGroceryItemGet(created.body.id, headers, devEnv, store, limiter, now + 4, "ip");
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.name, "Apples");
  assert.equal((await handleGroceryItemGet("missing-item", headers, devEnv, store, limiter, now + 5, "ip")).status, 404);

  const down = { listGrocery: async () => { throw new StoreError(); }, createGrocery: async () => { throw new StoreError(); }, getGrocery: async () => { throw new StoreError(); } };
  assert.equal((await handleGroceryGet(headers, devEnv, down, limiter, now, "ip")).status, 503);
  assert.equal((await handleGroceryPost({ name: "Apples" }, headers, devEnv, {}, limiter, now, "ip")).status, 503);
  assert.equal((await handleGroceryItemPatch(created.body.id, { name: "Pears" }, headers, devEnv, store, limiter, now, "ip")).status, 200);
  assert.equal((await handleGroceryItemPatch(created.body.id, { name: " " }, headers, devEnv, store, limiter, now, "ip")).status, 400);
  assert.equal((await handleGroceryItemDelete(created.body.id, headers, devEnv, store, limiter, now, "ip")).status, 200);
  assert.equal((await handleGroceryItemDelete(created.body.id, headers, devEnv, store, limiter, now, "ip")).status, 404);
  assert.equal((await handleGroceryItemPatch("missing-item", { name: "Gone" }, headers, devEnv, {}, limiter, now, "ip")).status, 503);
  assert.equal((await handleGroceryItemDelete("missing-item", headers, devEnv, {}, limiter, now, "ip")).status, 503);
});

test("a patch changes name and clears optional fields, and a failed write leaves the item", async () => {
  assert.equal(validateGroceryPatch({}).detail, "Item must include a field");
  assert.equal(validateGroceryPatch({ checked: true }).field, "checked");
  assert.equal(validateGroceryPatch({ name: "  " }).detail, "Enter a name.");
  const backend = createMemoryBackend();
  const created = await performCreate(backend, { name: "Oat milk", quantity: "1 carton", notes: "Barista style if they have it", section: "Dairy" }, "edit-1", 50, () => "item-edit-1");
  const id = created.body.id;
  const cleared = await performPatch(backend, id, { quantity: "", notes: "", section: "" }, 80);
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.name, "Oat milk");
  assert.equal(cleared.body.quantity, undefined);
  assert.equal(cleared.body.notes, undefined);
  assert.equal(cleared.body.section, undefined);
  assert.equal(cleared.body.createdAt, 50);
  const renamed = await performPatch(backend, id, { name: "Whole milk", section: "Dairy" }, 90);
  assert.equal(renamed.body.name, "Whole milk");
  assert.equal(renamed.body.section, "Dairy");
  const replaceItem = backend.replaceItem.bind(backend);
  const deleteItem = backend.deleteItem.bind(backend);
  backend.replaceItem = async () => {
    throw new Error("down");
  };
  await assert.rejects(() => performPatch(backend, id, { name: "Lost" }, 100));
  const kept = await backend.getItem(id);
  assert.equal(kept.name, "Whole milk");
  backend.replaceItem = replaceItem;
  backend.deleteItem = async () => {
    throw new Error("down");
  };
  await assert.rejects(() => performDelete(backend, id));
  assert.equal((await backend.getItem(id)).name, "Whole milk");
  backend.deleteItem = deleteItem;
  const gone = await performDelete(backend, id);
  assert.deepEqual(gone.body, { deleted: true, id });
  assert.equal(await backend.getItem(id), null);
  assert.equal((await performDelete(backend, id)).status, 404);
  const other = await performCreate(backend, { name: "Oat milk" }, "edit-2", 10, () => "item-edit-2");
  assert.equal(existingName([other.body, { id: "item-edit-2", name: "Oat milk", createdAt: 10 }], "Oat milk", "item-edit-2"), "");
  assert.equal(sectionSuggestions([{ section: "Bakery", createdAt: 2, checked: true }, { section: "Produce", createdAt: 1 }])[0], "Produce");
});
