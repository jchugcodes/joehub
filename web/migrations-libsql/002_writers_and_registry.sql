-- Append-only. Assigns an owner to every table, adds writer principals
-- and human delegations, and records fencing plus request fingerprints.
-- Existing tables and indexes stay in place.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS principals (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    name TEXT NOT NULL UNIQUE CHECK (length(name) > 0),
    kind TEXT NOT NULL CHECK (kind IN ('human', 'owner', 'bot')),
    owner_name TEXT CHECK (owner_name IS NULL OR owner_name IN ('Ledger', 'Scout', 'Cato')),
    token_sha256 TEXT NOT NULL UNIQUE CHECK (length(token_sha256) = 64),
    CHECK (
        (kind = 'owner' AND owner_name IS NOT NULL)
        OR (kind != 'owner' AND owner_name IS NULL)
    )
);

CREATE TRIGGER IF NOT EXISTS trg_principals_id_immutable
BEFORE UPDATE OF id ON principals
FOR EACH ROW BEGIN
    SELECT RAISE(ABORT, 'immutable primary key');
END;

CREATE TABLE IF NOT EXISTS delegations (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    human_principal_id TEXT NOT NULL REFERENCES principals(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    owner_name TEXT NOT NULL CHECK (owner_name IN ('Ledger', 'Scout', 'Cato')),
    granted_at TEXT NOT NULL CHECK (
        granted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    revoked_at TEXT CHECK (
        revoked_at IS NULL OR revoked_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    note TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delegations_one_active
    ON delegations (human_principal_id, owner_name)
    WHERE revoked_at IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_delegations_id_immutable
BEFORE UPDATE OF id ON delegations
FOR EACH ROW BEGIN
    SELECT RAISE(ABORT, 'immutable primary key');
END;

ALTER TABLE locks ADD COLUMN fence INTEGER NOT NULL DEFAULT 0;

ALTER TABLE write_queue ADD COLUMN request_fingerprint TEXT;
ALTER TABLE write_queue ADD COLUMN actor_principal_id TEXT;
ALTER TABLE write_queue ADD COLUMN fence INTEGER;

ALTER TABLE export_history ADD COLUMN publication_state TEXT CHECK (
    publication_state IS NULL OR publication_state IN (
        'not_requested', 'pushed', 'refused', 'failed', 'incomplete'
    )
);

INSERT OR IGNORE INTO table_registry (
    id, notion_id, migrated_on, last_modified_by, last_modified_at, table_name, owner_id
) VALUES
('018f0000-0000-7000-8000-000000000114', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'schema_migrations', '018f0000-0000-7000-8000-000000000003'),
('018f0000-0000-7000-8000-000000000115', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'owners', '018f0000-0000-7000-8000-000000000003'),
('018f0000-0000-7000-8000-000000000116', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'table_registry', '018f0000-0000-7000-8000-000000000003'),
('018f0000-0000-7000-8000-000000000117', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'write_queue', '018f0000-0000-7000-8000-000000000003'),
('018f0000-0000-7000-8000-000000000118', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'locks', '018f0000-0000-7000-8000-000000000003'),
('018f0000-0000-7000-8000-000000000119', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'errors', '018f0000-0000-7000-8000-000000000003'),
('018f0000-0000-7000-8000-000000000120', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'pending_deletes', '018f0000-0000-7000-8000-000000000003'),
('018f0000-0000-7000-8000-000000000121', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'principals', '018f0000-0000-7000-8000-000000000003'),
('018f0000-0000-7000-8000-000000000122', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'delegations', '018f0000-0000-7000-8000-000000000003');
