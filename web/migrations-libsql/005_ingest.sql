-- Ingest idempotency and per-principal rate limits. Append-only.
-- 001 through 004 are unchanged.

CREATE TABLE IF NOT EXISTS ingest_idempotency (
    principal_id TEXT NOT NULL CHECK (length(principal_id) = 36) REFERENCES principals(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    entity TEXT NOT NULL CHECK (length(entity) > 0 AND length(entity) <= 40),
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) > 0 AND length(idempotency_key) <= 200),
    body_sha256 TEXT NOT NULL CHECK (length(body_sha256) = 64),
    status_code INTEGER NOT NULL CHECK (status_code >= 0),
    response_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (principal_id, entity, idempotency_key)
);

CREATE TABLE IF NOT EXISTS ingest_rate (
    principal_id TEXT NOT NULL CHECK (length(principal_id) = 36) REFERENCES principals(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    window_start INTEGER NOT NULL,
    hits INTEGER NOT NULL CHECK (hits >= 0),
    PRIMARY KEY (principal_id, window_start)
);
