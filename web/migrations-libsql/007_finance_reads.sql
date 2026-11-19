-- Finance read mapping. 001 and 002 are unchanged, and no box column is altered.
-- finance_ids maps a web id onto a box UUID.
-- finance_docs and finance_blobs hold the web documents the API returns.
-- finance_goal_status holds the web status, including not_started and inactive.
-- The box goals.status check cannot store those two values.

CREATE TABLE finance_ids (
    entity TEXT NOT NULL CHECK (entity IN ('category', 'account', 'transaction', 'goal', 'bill', 'budget')),
    web_id TEXT NOT NULL CHECK (length(web_id) > 0),
    box_id TEXT NOT NULL CHECK (length(box_id) = 36),
    PRIMARY KEY (entity, web_id),
    UNIQUE (entity, box_id)
);

CREATE TABLE finance_docs (
    entity TEXT NOT NULL CHECK (entity IN ('account', 'transaction', 'bill')),
    web_id TEXT NOT NULL CHECK (length(web_id) > 0),
    body TEXT NOT NULL,
    sort_key INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (entity, web_id)
);

CREATE INDEX finance_docs_order ON finance_docs (entity, sort_key, web_id);

CREATE TABLE finance_blobs (
    key TEXT PRIMARY KEY,
    body TEXT NOT NULL
);

CREATE TABLE finance_goal_status (
    box_id TEXT PRIMARY KEY CHECK (length(box_id) = 36),
    status TEXT NOT NULL CHECK (status IN ('active', 'not_started', 'paused', 'inactive'))
);
