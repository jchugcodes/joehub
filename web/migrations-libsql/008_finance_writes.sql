-- Finance write bookkeeping. 001 through 007 are unchanged.
-- finance_idem stores a successful Idempotency-Key response for 24 hours.
-- finance_sources is the joehub:finance:txn:bysource:{sourceId} index.
-- Neither table is a box table. A bundle rewrite does not delete finance_idem.

CREATE TABLE finance_idem (
    key TEXT PRIMARY KEY CHECK (length(key) > 0),
    body TEXT NOT NULL,
    expires_at INTEGER NOT NULL CHECK (typeof(expires_at) = 'integer')
);

CREATE TABLE finance_sources (
    source_id TEXT PRIMARY KEY CHECK (length(source_id) > 0),
    web_id TEXT NOT NULL CHECK (length(web_id) > 0)
);
