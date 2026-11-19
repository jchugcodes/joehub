-- Grocery documents, check time, idempotency, and the seed flag.
-- 001 through 005 are unchanged. grocery_items from 004 stays.
-- body is the Upstash item document. checked_at is the check time.
-- A later migration may add a column again; the migrator skips one that exists.

ALTER TABLE grocery_items ADD COLUMN body TEXT;
ALTER TABLE grocery_items ADD COLUMN checked_at INTEGER;

CREATE TABLE grocery_idempotency (
    key TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE grocery_flags (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
