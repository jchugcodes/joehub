-- joehub schema migration 001
-- Creates the full schema. Later migrations are append-only.
-- Money is integer cents. Primary keys are immutable UUID text.
-- Each domain table is owned by exactly one row in owners, via table_registry.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    version TEXT NOT NULL UNIQUE CHECK (length(version) > 0),
    applied_at TEXT NOT NULL CHECK (
        applied_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    )
);

CREATE TABLE IF NOT EXISTS owners (
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
    description TEXT NOT NULL CHECK (length(description) > 0)
);

CREATE TABLE IF NOT EXISTS table_registry (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    table_name TEXT NOT NULL UNIQUE CHECK (length(table_name) > 0),
    owner_id TEXT NOT NULL REFERENCES owners(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS write_queue (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) > 0),
    owner_name TEXT NOT NULL CHECK (length(owner_name) > 0),
    table_name TEXT NOT NULL CHECK (length(table_name) > 0),
    operation TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete_request', 'delete_confirm')),
    payload_json TEXT NOT NULL CHECK (length(payload_json) > 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'committed', 'failed', 'rolled_back')),
    row_id TEXT CHECK (row_id IS NULL OR length(row_id) = 36),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    created_at TEXT NOT NULL CHECK (
        created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    completed_at TEXT CHECK (
        completed_at IS NULL OR completed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    )
);

CREATE TABLE IF NOT EXISTS locks (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    lock_name TEXT NOT NULL UNIQUE CHECK (length(lock_name) > 0),
    holder_id TEXT NOT NULL CHECK (length(holder_id) > 0),
    acquired_at TEXT NOT NULL CHECK (
        acquired_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    expires_at TEXT NOT NULL CHECK (
        expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    ttl_seconds INTEGER NOT NULL CHECK (ttl_seconds > 0)
);

CREATE TABLE IF NOT EXISTS errors (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    idempotency_key TEXT CHECK (idempotency_key IS NULL OR length(idempotency_key) > 0),
    owner_name TEXT NOT NULL CHECK (length(owner_name) > 0),
    table_name TEXT CHECK (table_name IS NULL OR length(table_name) > 0),
    operation TEXT CHECK (
        operation IS NULL OR operation IN ('insert', 'update', 'delete_request', 'delete_confirm')
    ),
    message TEXT NOT NULL CHECK (length(message) > 0),
    persistent INTEGER NOT NULL CHECK (persistent IN (0, 1)),
    created_at TEXT NOT NULL CHECK (
        created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    )
);

CREATE INDEX IF NOT EXISTS idx_errors_idempotency ON errors (idempotency_key);

CREATE TABLE IF NOT EXISTS pending_deletes (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    owner_name TEXT NOT NULL CHECK (length(owner_name) > 0),
    table_name TEXT NOT NULL CHECK (length(table_name) > 0),
    row_id TEXT NOT NULL CHECK (length(row_id) = 36),
    requested_at TEXT NOT NULL CHECK (
        requested_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    confirmed_at TEXT CHECK (
        confirmed_at IS NULL OR confirmed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled')),
    CHECK (status != 'confirmed' OR confirmed_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_deletes_one_open
    ON pending_deletes (table_name, row_id)
    WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    name TEXT NOT NULL CHECK (length(name) > 0),
    kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer'))
);

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    name TEXT NOT NULL CHECK (length(name) > 0),
    account_type TEXT NOT NULL CHECK (account_type IN ('checking', 'savings', 'credit', 'cash', 'investment', 'other')),
    institution TEXT,
    currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3)
);

CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    name TEXT NOT NULL CHECK (length(name) > 0),
    category_id TEXT NOT NULL REFERENCES categories(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    account_id TEXT REFERENCES accounts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    period TEXT NOT NULL CHECK (period IN ('weekly', 'monthly', 'yearly')),
    amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents >= 0),
    start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    end_date TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    name TEXT NOT NULL CHECK (length(name) > 0),
    target_cents INTEGER NOT NULL CHECK (typeof(target_cents) = 'integer' AND target_cents >= 0),
    current_cents INTEGER NOT NULL DEFAULT 0 CHECK (typeof(current_cents) = 'integer' AND current_cents >= 0),
    target_date TEXT CHECK (target_date IS NULL OR target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    account_id TEXT REFERENCES accounts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    account_id TEXT NOT NULL REFERENCES accounts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    category_id TEXT REFERENCES categories(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    goal_id TEXT REFERENCES goals(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer'),
    date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    payee TEXT,
    memo TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date);

CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    name TEXT NOT NULL CHECK (length(name) > 0),
    website TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    company_id TEXT REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(name) > 0),
    email TEXT,
    role TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    company_id TEXT REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    contact_id TEXT REFERENCES contacts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    role_title TEXT NOT NULL CHECK (length(role_title) > 0),
    status TEXT NOT NULL CHECK (status IN ('Interested', 'Applied', 'Interviewing', 'Offer', 'Rejected', 'Passed')),
    applied_on TEXT CHECK (applied_on IS NULL OR applied_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    notes TEXT,
    raw_company TEXT,
    raw_contact TEXT,
    raw_status TEXT,
    raw_source TEXT
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications (status);

CREATE TABLE IF NOT EXISTS application_status_history (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    application_id TEXT NOT NULL REFERENCES applications(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    from_status TEXT CHECK (
        from_status IS NULL OR from_status IN ('Interested', 'Applied', 'Interviewing', 'Offer', 'Rejected', 'Passed')
    ),
    to_status TEXT NOT NULL CHECK (to_status IN ('Interested', 'Applied', 'Interviewing', 'Offer', 'Rejected', 'Passed')),
    event_kind TEXT NOT NULL CHECK (event_kind IN ('migration_baseline', 'transition')),
    occurred_at TEXT NOT NULL CHECK (
        occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    note TEXT
);

CREATE INDEX IF NOT EXISTS idx_history_application ON application_status_history (application_id);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    title TEXT NOT NULL CHECK (length(title) > 0),
    starts_at TEXT NOT NULL CHECK (
        starts_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    ends_at TEXT CHECK (
        ends_at IS NULL OR ends_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    location TEXT,
    notes TEXT,
    CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    entry_date TEXT NOT NULL CHECK (entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    title TEXT,
    body TEXT NOT NULL CHECK (length(body) > 0),
    mood TEXT
);

CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries (entry_date);

CREATE TABLE IF NOT EXISTS bot_activity (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    bot_name TEXT NOT NULL CHECK (length(bot_name) > 0),
    action TEXT NOT NULL CHECK (length(action) > 0),
    occurred_at TEXT NOT NULL CHECK (
        occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    detail TEXT
);

CREATE TABLE IF NOT EXISTS export_history (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    notion_id TEXT UNIQUE CHECK (notion_id IS NULL OR length(notion_id) > 0),
    migrated_on TEXT CHECK (
        migrated_on IS NULL OR migrated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    last_modified_by TEXT NOT NULL CHECK (length(last_modified_by) > 0),
    last_modified_at TEXT NOT NULL CHECK (
        last_modified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    started_at TEXT NOT NULL CHECK (
        started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    finished_at TEXT CHECK (
        finished_at IS NULL OR finished_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'
    ),
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    export_dir TEXT NOT NULL CHECK (length(export_dir) > 0),
    remote TEXT,
    push_status TEXT CHECK (push_status IS NULL OR push_status IN ('pushed', 'refused', 'failed')),
    detail TEXT
);

INSERT OR IGNORE INTO owners (
    id, notion_id, migrated_on, last_modified_by, last_modified_at, name, description
) VALUES
(
    '018f0000-0000-7000-8000-000000000001',
    NULL,
    NULL,
    'system',
    '2026-01-01T00:00:00Z',
    'Ledger',
    'Finance: accounts, categories, budgets, goals, and transactions.'
),
(
    '018f0000-0000-7000-8000-000000000002',
    NULL,
    NULL,
    'system',
    '2026-01-01T00:00:00Z',
    'Scout',
    'Job search: companies, contacts, and applications.'
),
(
    '018f0000-0000-7000-8000-000000000003',
    NULL,
    NULL,
    'system',
    '2026-01-01T00:00:00Z',
    'Cato',
    'Life log: events, journal, bot activity, and export history.'
);

INSERT OR IGNORE INTO table_registry (
    id, notion_id, migrated_on, last_modified_by, last_modified_at, table_name, owner_id
) VALUES
('018f0000-0000-7000-8000-000000000101', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'categories', '018f0000-0000-7000-8000-000000000001'),
('018f0000-0000-7000-8000-000000000102', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'accounts', '018f0000-0000-7000-8000-000000000001'),
('018f0000-0000-7000-8000-000000000103', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'budgets', '018f0000-0000-7000-8000-000000000001'),
('018f0000-0000-7000-8000-000000000104', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'goals', '018f0000-0000-7000-8000-000000000001'),
('018f0000-0000-7000-8000-000000000105', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'transactions', '018f0000-0000-7000-8000-000000000001'),
('018f0000-0000-7000-8000-000000000106', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'companies', '018f0000-0000-7000-8000-000000000002'),
('018f0000-0000-7000-8000-000000000107', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'contacts', '018f0000-0000-7000-8000-000000000002'),
('018f0000-0000-7000-8000-000000000108', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'applications', '018f0000-0000-7000-8000-000000000002'),
('018f0000-0000-7000-8000-000000000109', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'application_status_history', '018f0000-0000-7000-8000-000000000002'),
('018f0000-0000-7000-8000-000000000110', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'events', '018f0000-0000-7000-8000-000000000003'),
('018f0000-0000-7000-8000-000000000111', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'journal_entries', '018f0000-0000-7000-8000-000000000003'),
('018f0000-0000-7000-8000-000000000112', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'bot_activity', '018f0000-0000-7000-8000-000000000003'),
('018f0000-0000-7000-8000-000000000113', NULL, NULL, 'system', '2026-01-01T00:00:00Z', 'export_history', '018f0000-0000-7000-8000-000000000003');

CREATE TRIGGER IF NOT EXISTS trg_schema_migrations_id_immutable BEFORE UPDATE OF id ON schema_migrations FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_owners_id_immutable BEFORE UPDATE OF id ON owners FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_table_registry_id_immutable BEFORE UPDATE OF id ON table_registry FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_write_queue_id_immutable BEFORE UPDATE OF id ON write_queue FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_locks_id_immutable BEFORE UPDATE OF id ON locks FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_errors_id_immutable BEFORE UPDATE OF id ON errors FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_pending_deletes_id_immutable BEFORE UPDATE OF id ON pending_deletes FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_categories_id_immutable BEFORE UPDATE OF id ON categories FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_accounts_id_immutable BEFORE UPDATE OF id ON accounts FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_budgets_id_immutable BEFORE UPDATE OF id ON budgets FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_goals_id_immutable BEFORE UPDATE OF id ON goals FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_transactions_id_immutable BEFORE UPDATE OF id ON transactions FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_companies_id_immutable BEFORE UPDATE OF id ON companies FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_contacts_id_immutable BEFORE UPDATE OF id ON contacts FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_applications_id_immutable BEFORE UPDATE OF id ON applications FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_application_status_history_id_immutable BEFORE UPDATE OF id ON application_status_history FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_events_id_immutable BEFORE UPDATE OF id ON events FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_journal_entries_id_immutable BEFORE UPDATE OF id ON journal_entries FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_bot_activity_id_immutable BEFORE UPDATE OF id ON bot_activity FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
CREATE TRIGGER IF NOT EXISTS trg_export_history_id_immutable BEFORE UPDATE OF id ON export_history FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'immutable primary key'); END;
