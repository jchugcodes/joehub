-- Grocery and list stubs. The box database has neither.
-- Columns follow the Upstash documents in web/lib/grocery.mjs and web/lib/list-store.mjs.
-- No store reads these tables yet. A list's task count is not stored:
-- tasks point at a list through the project field inside tasks.body.

CREATE TABLE grocery_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    quantity TEXT,
    notes TEXT,
    section TEXT,
    checked INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    source_id TEXT
);

CREATE INDEX grocery_items_source ON grocery_items(source_id);

CREATE TABLE lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
