export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const GROCERY_NAMESPACE = "6c4e1a90-2b77-4f18-9d33-1a8e5c0b7d44";
const ITEM_ID = /^[A-Za-z0-9-]{1,80}$/;
const PENDING_MS = 30 * 1000;
const CREATE_FIELDS = new Set(["name", "quantity", "notes", "section"]);
export const NO_SECTION = "No section";

export const SAMPLE_GROCERY = [
  {
    id: "g1g1g1g1-g1g1-4g1g-8g1g-g1g1g1g1g1g1",
    name: "Bananas",
    quantity: "6",
    section: "Produce",
    checked: false,
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
  },
  {
    id: "g2g2g2g2-g2g2-4g2g-8g2g-g2g2g2g2g2g2",
    name: "Organic gluten-free rolled oats, family size",
    quantity: "1 bag",
    section: "Produce",
    checked: false,
    createdAt: 1_760_000_001_000,
    updatedAt: 1_760_000_001_000,
  },
  {
    id: "g3g3g3g3-g3g3-4g3g-8g3g-g3g3g3g3g3g3",
    name: "Oat milk",
    quantity: "1 carton",
    section: "Dairy",
    notes: "Barista style if they have it",
    checked: false,
    createdAt: 1_760_000_002_000,
    updatedAt: 1_760_000_002_000,
  },
  {
    id: "g4g4g4g4-g4g4-4g4g-8g4g-g4g4g4g4g4g4",
    name: "Eggs",
    quantity: "1 dozen",
    section: "Dairy",
    checked: false,
    createdAt: 1_760_000_003_000,
    updatedAt: 1_760_000_003_000,
  },
  {
    id: "g5g5g5g5-g5g5-4g5g-8g5g-g5g5g5g5g5g5",
    name: "Paper towels",
    quantity: "2",
    checked: false,
    createdAt: 1_760_000_004_000,
    updatedAt: 1_760_000_004_000,
  },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reject(field, detail) {
  const body = { ok: false, detail };
  if (field) body.field = field;
  return body;
}

export function isItemId(id) {
  return typeof id === "string" && ITEM_ID.test(id);
}

export function parseQuantity(value) {
  if (value == null || value === "") return { ok: true, quantity: "" };
  if (typeof value !== "string") return { ok: false, detail: "Enter a valid quantity." };
  const quantity = value.trim();
  if (!quantity) return { ok: true, quantity: "" };
  if (quantity.length > 80) return { ok: false, detail: "Quantity is too long." };
  if (/^-\s*\d/.test(quantity) || !/[A-Za-z0-9]/.test(quantity)) {
    return { ok: false, detail: "Enter a valid quantity." };
  }
  return { ok: true, quantity };
}

function optionalText(value, field, emptyDetail, max, tooLong) {
  if (value == null || value === "") return { ok: true, text: "" };
  if (typeof value !== "string") return reject(field, emptyDetail);
  const text = value.trim();
  if (text.length > max) return reject(field, tooLong);
  return { ok: true, text };
}

export function validateGroceryCreate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reject("", "Item must be an object");
  }
  for (const key of Object.keys(body)) {
    if (!CREATE_FIELDS.has(key)) return reject(key, `${key} isn't accepted.`);
  }
  if (typeof body.name !== "string") return reject("name", "Enter a name.");
  const name = body.name.trim();
  if (!name) return reject("name", "Enter a name.");
  if (name.length > 200) return reject("name", "Name is too long.");

  const quantity = parseQuantity(body.quantity);
  if (!quantity.ok) return reject("quantity", quantity.detail);

  const notes = optionalText(body.notes, "notes", "Notes must be text.", 4000, "Notes are too long.");
  if (!notes.ok) return notes;
  const section = optionalText(body.section, "section", "Section must be text.", 120, "Section is too long.");
  if (!section.ok) return section;

  return { ok: true, name, quantity: quantity.quantity, notes: notes.text, section: section.text };
}

function itemFrom(parsed, id, now) {
  const item = {
    id,
    name: parsed.name,
    checked: false,
    createdAt: now,
    updatedAt: now,
  };
  if (parsed.quantity) item.quantity = parsed.quantity;
  if (parsed.notes) item.notes = parsed.notes;
  if (parsed.section) item.section = parsed.section;
  return item;
}

function newItemId() {
  return globalThis.crypto.randomUUID();
}

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
}

export async function itemIdForKey(scope, key) {
  const name = new TextEncoder().encode(`${scope}\0${key}`);
  const data = new Uint8Array(16 + name.length);
  data.set(uuidToBytes(GROCERY_NAMESPACE), 0);
  data.set(name, 16);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-1", data));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sectionLabel(item) {
  const section = typeof item.section === "string" ? item.section.trim() : "";
  return section || NO_SECTION;
}

function byCreated(left, right) {
  return left.createdAt - right.createdAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export function groupGrocery(items) {
  const rows = (Array.isArray(items) ? items : []).filter((item) => item && typeof item.name === "string");
  const unchecked = rows.filter((item) => !item.checked);
  const checked = rows.filter((item) => item.checked);
  const buckets = new Map();
  for (const item of unchecked) {
    const label = sectionLabel(item);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(item);
  }
  const named = [...buckets.entries()].filter(([label]) => label !== NO_SECTION);
  named.sort((left, right) => {
    const leftAt = Math.min(...left[1].map((item) => item.createdAt));
    const rightAt = Math.min(...right[1].map((item) => item.createdAt));
    return leftAt - rightAt || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
  });
  const groups = named.map(([label, group]) => ({ label, items: group.slice().sort(byCreated) }));
  if (buckets.has(NO_SECTION)) {
    groups.push({ label: NO_SECTION, items: buckets.get(NO_SECTION).slice().sort(byCreated) });
  }
  if (checked.length) {
    groups.push({
      label: "Checked",
      items: checked.slice().sort((left, right) => (left.checkedAt || left.updatedAt) - (right.checkedAt || right.updatedAt) || byCreated(left, right)),
    });
  }
  return groups;
}

export function existingName(items, name) {
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return "";
  const found = (Array.isArray(items) ? items : [])
    .filter((item) => item && String(item.name || "").trim().toLowerCase() === needle)
    .sort(byCreated);
  return found[0] ? found[0].name : "";
}

export async function performCreate(backend, raw, idemKey, now, newId = newItemId, scope = "") {
  const parsed = validateGroceryCreate(raw);
  if (!parsed.ok) {
    const body = { detail: parsed.detail };
    if (parsed.field) body.field = parsed.field;
    return { status: 400, body };
  }
  const storedKey = idemKey && scope ? `${scope}\0${idemKey}` : idemKey;
  let claimed = false;
  if (storedKey) {
    const stored = await backend.readIdem(storedKey, now);
    if (stored) return stored;
    claimed = await backend.claimIdem(storedKey, now);
    if (!claimed) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const again = await backend.readIdem(storedKey, now);
        if (again) return again;
        await delay(25);
      }
      return { status: 503, body: { detail: "unavailable" } };
    }
  }
  let created = false;
  try {
    if (storedKey) {
      const stored = await backend.readIdem(storedKey, now);
      if (stored) return stored;
    }
    const id = idemKey && newId === newItemId ? await itemIdForKey(scope || "", idemKey) : newId();
    const item = itemFrom(parsed, id, now);
    const inserted = await backend.putItem(item);
    if (inserted === false) {
      const existing = await backend.getItem(id);
      if (!existing) throw new Error("unavailable");
      const replay = { status: 201, body: existing };
      if (storedKey) {
        try {
          await backend.writeIdem(storedKey, replay, now);
        } catch {
          // The stored item is still the one this key names.
        }
      }
      claimed = false;
      return replay;
    }
    created = true;
    const response = { status: 201, body: item };
    if (storedKey) {
      try {
        await backend.writeIdem(storedKey, response, now);
      } catch (error) {
        try {
          await backend.noteCreated(storedKey, response, now);
        } catch {
          // Leave the short pending claim. Releasing it would allow a second item.
        }
        throw error;
      }
    }
    claimed = false;
    return response;
  } catch (error) {
    if (claimed && !created) {
      try {
        await backend.releasePending(storedKey, now);
      } catch {
        // The original store error is the one the caller should see.
      }
    }
    throw error;
  }
}

export function createMemoryBackend() {
  const items = new Map();
  const idem = new Map();
  return {
    items,
    idem,
    async putItem(item) {
      if (items.has(item.id)) return false;
      items.set(item.id, structuredClone(item));
      return true;
    },
    async getItem(id) {
      if (!isItemId(id)) return null;
      const item = items.get(id);
      return item ? structuredClone(item) : null;
    },
    async list() {
      return [...items.values()]
        .map((item) => structuredClone(item))
        .sort(byCreated);
    },
    async readIdem(key, now) {
      const row = idem.get(key);
      if (!row || !row.response) return null;
      if (now >= row.expiresAt) {
        idem.delete(key);
        return null;
      }
      return structuredClone(row.response);
    },
    async writeIdem(key, response, now) {
      idem.set(key, { response: structuredClone(response), expiresAt: now + IDEMPOTENCY_TTL_MS });
    },
    async noteCreated(key, response, now) {
      const itemId = response && response.body ? response.body.id : "";
      idem.set(key, {
        response: structuredClone(response),
        expiresAt: now + IDEMPOTENCY_TTL_MS,
        itemId,
      });
    },
    async claimIdem(key, now) {
      const row = idem.get(key);
      if (row && row.response && now < row.expiresAt) return false;
      if (row && row.pendingUntil && now < row.pendingUntil && !row.response) return false;
      idem.set(key, { pendingUntil: now + PENDING_MS });
      return true;
    },
    async releasePending(key) {
      const row = idem.get(key);
      if (row && !row.response) idem.delete(key);
    },
  };
}

export function installMemoryGrocery(store, options = {}) {
  const backend = createMemoryBackend();
  const seed = options.seed ?? process.env.JOEHUB_SEED_GROCERY === "1";
  if (seed) {
    for (const sample of SAMPLE_GROCERY) backend.items.set(sample.id, structuredClone(sample));
  }
  store.listGrocery = () => backend.list();
  store.createGrocery = (raw, idemKey, now, scope) => performCreate(backend, raw, idemKey, now, newItemId, scope || "");
  store.getGrocery = (id) => backend.getItem(id);
  return store;
}
