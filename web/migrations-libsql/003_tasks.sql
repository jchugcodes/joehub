-- Tasks area. The box database has no tasks tables.
-- Columns match the S1 store in web/lib/store-sqlite.mjs.
-- This file does not change any table from 001 or 002.

CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    source_id TEXT
);

CREATE INDEX tasks_source ON tasks(source_id);

CREATE TABLE task_idempotency (
    key TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE task_flags (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
