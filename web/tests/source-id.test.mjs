import assert from "node:assert/strict";
import test from "node:test";
import { createTransaction, patchTransaction, presentTransaction } from "../lib/finance.mjs";
import { createMemoryBackend as createGroceryBackend, performCreate as createGrocery, performPatch as patchGrocery } from "../lib/grocery.mjs";
import { createMemoryBackend, performCreate, performPatch } from "../lib/tasks.mjs";

const SOURCE = "notion:01234567-89ab-cdef-0123-456789abcdef";

test("tasks store an optional sourceId and reject a bad one", async () => {
  const backend = createMemoryBackend();
  const created = await performCreate(backend, { title: "Imported", sourceId: SOURCE }, "", 1_000);
  assert.equal(created.status, 201);
  assert.equal(created.body.sourceId, SOURCE);
  const plain = await performCreate(backend, { title: "Local" }, "", 1_100);
  assert.equal(plain.body.sourceId, undefined);
  const bad = await performCreate(backend, { title: "Nope", sourceId: "has space" }, "", 1_200);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, "sourceId");
  const cleared = await performPatch(backend, created.body.id, { sourceId: "" }, 1_300);
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.sourceId, undefined);
  const kept = await performPatch(backend, created.body.id, { title: "Imported still" }, 1_400);
  assert.equal(kept.body.sourceId, undefined);
});

test("grocery items store an optional sourceId", async () => {
  const backend = createGroceryBackend();
  const created = await createGrocery(backend, { name: "Oats", sourceId: SOURCE }, "", 2_000);
  assert.equal(created.status, 201);
  assert.equal(created.body.sourceId, SOURCE);
  const rejected = await createGrocery(backend, { name: "Milk", mystery: true }, "", 2_100);
  assert.equal(rejected.status, 400);
  const cleared = await patchGrocery(backend, created.body.id, { sourceId: null }, 2_200);
  assert.equal(cleared.body.sourceId, undefined);
});

test("transactions keep sourceId on the row and omit it when absent", () => {
  const created = createTransaction([], { payee: "Market", amountCents: 1200, date: "2026-11-10", type: "expense", category: "groceries", sourceId: SOURCE }, 3_000, 1);
  assert.equal(created.status, 201);
  assert.equal(created.body.sourceId, SOURCE);
  assert.equal(created.rows[0].sourceId, SOURCE);
  const plain = createTransaction([], { payee: "Market", amountCents: 1200, date: "2026-11-10", type: "expense", category: "groceries" }, 3_100, 1);
  assert.equal(Object.hasOwn(plain.body, "sourceId"), false);
  const bad = createTransaction([], { payee: "Market", amountCents: 1200, date: "2026-11-10", type: "expense", category: "groceries", sourceId: 4 }, 3_200, 1);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, "sourceId");
  const patched = patchTransaction(created.rows, created.rows[0].id, { sourceId: "" }, 3_300);
  assert.equal(patched.body.sourceId, undefined);
  const stored = presentTransaction({ id: "fin-ext", payee: "Old", amountCents: -100, date: "2026-11-10", category: "shopping", type: "expense", source: "manual", createdAt: 1, sourceId: "notion:already" });
  assert.equal(stored.sourceId, "notion:already");
});
