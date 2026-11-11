"""The separable API can call joehub's fixed read functions without opening the default database."""

from __future__ import annotations

import sqlite3

from fastapi.testclient import TestClient

from joehub_api.app import create_app
from joehub_api.read_source import QueryReadSource
from joehub_api.sessions import COOKIE_NAME
from joehub_api.settings import ApiSettings

SECRET = "test-session-secret"
CREDENTIAL = "scoped-read-credential"


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE accounts (
            id TEXT, name TEXT, account_type TEXT, institution TEXT
        );
        CREATE TABLE transactions (
            id TEXT, account_id TEXT, category_id TEXT, amount_cents INTEGER,
            date TEXT, payee TEXT, memo TEXT, last_modified_at TEXT
        );
        CREATE TABLE categories (id TEXT, name TEXT);
        CREATE TABLE companies (id TEXT, name TEXT);
        CREATE TABLE applications (
            id TEXT, role_title TEXT, status TEXT, applied_on TEXT,
            raw_company TEXT, raw_contact TEXT, raw_status TEXT, raw_source TEXT,
            notes TEXT, company_id TEXT, last_modified_at TEXT
        );
        CREATE TABLE journal_entries (
            id TEXT, entry_date TEXT, title TEXT, body TEXT, mood TEXT, last_modified_at TEXT
        );
        CREATE TABLE events (
            id TEXT, title TEXT, starts_at TEXT, ends_at TEXT, location TEXT, notes TEXT
        );
        """
    )
    conn.execute(
        "INSERT INTO accounts (id, name, account_type, institution) VALUES (?, ?, ?, ?)",
        ("acct-1", "Layer Checking", "checking", "Fixture Bank"),
    )
    conn.execute(
        """
        INSERT INTO transactions (
            id, account_id, category_id, amount_cents, date, payee, memo, last_modified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("txn-1", "acct-1", None, 2500, "2026-01-02", "Layer Payee", None, "2026-01-02T00:00:00Z"),
    )
    conn.execute(
        """
        INSERT INTO applications (
            id, role_title, status, applied_on, raw_company, raw_contact, raw_status,
            raw_source, notes, company_id, last_modified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "app-1",
            "Layer Role",
            "Applied",
            "2026-01-03",
            "Layer Co",
            None,
            "Applied",
            None,
            None,
            None,
            "2026-01-03T00:00:00Z",
        ),
    )
    conn.execute(
        """
        INSERT INTO journal_entries (id, entry_date, title, body, mood, last_modified_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        ("entry-1", "2026-01-04", "Layer title", "Layer body", None, "2026-01-04T00:00:00Z"),
    )
    conn.execute(
        "INSERT INTO events (id, title, starts_at, ends_at, location, notes) VALUES (?, ?, ?, ?, ?, ?)",
        ("event-1", "Layer event", "2026-01-05T00:00:00Z", None, None, None),
    )
    return conn


def test_query_source_serves_the_read_layer() -> None:
    settings = ApiSettings(
        env="development",
        dev_auth=True,
        fake_auth=False,
        session_secret=SECRET,
        read_credential=CREDENTIAL,
    )
    app = create_app(settings, environ={}, source=QueryReadSource(_conn(), CREDENTIAL))
    client = TestClient(app)
    response = client.post(
        "/api/session/login",
        json={"username": "synthetic", "password": "synthetic"},
    )
    cookie = response.headers["set-cookie"].split(";", 1)[0].split("=", 1)[1]
    accounts = client.get("/api/finance/accounts", cookies={COOKIE_NAME: cookie})
    assert accounts.status_code == 200
    snapshot = accounts.json()
    assert snapshot["netWorthCents"] == 1_847_236
    assert snapshot["accounts"][0]["name"] == "Example checking"
    entries = client.get("/api/journal/entries", cookies={COOKIE_NAME: cookie})
    assert entries.json()[0]["body"] == "Layer body"
    applications = client.get("/api/jobs/applications", cookies={COOKIE_NAME: cookie})
    assert applications.json()[0]["role_title"] == "Layer Role"
    events = client.get("/api/journal/events", cookies={COOKIE_NAME: cookie})
    assert events.json()[0]["title"] == "Layer event"


def test_api_package_does_not_open_sqlite_or_load_writer_settings() -> None:
    root = __import__("pathlib").Path(__file__).resolve().parents[1] / "joehub_api"
    text = "\n".join(path.read_text(encoding="utf-8") for path in root.rglob("*.py"))
    assert "sqlite3.connect" not in text
    assert "load_settings" not in text
    assert "joehub.config" not in text
    assert "joehub.backup" not in text
    assert "joehub.write" not in text
    assert "operator.token" not in text
    assert "age-identity" not in text
