"""HTTP coverage for sessions, rate limits, and the synthetic contract."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from joehub_api.app import create_app
from joehub_api.sessions import COOKIE_NAME, SESSION_DAYS
from joehub_api.settings import MIN_SECRET_LENGTH, SYNTHETIC_READ_CREDENTIAL, ApiSettings, StartupError

SECRET = "test-session-secret"
REPO = Path(__file__).resolve().parents[2]
CONTRACT = json.loads((REPO / "contract" / "openapi.json").read_text(encoding="utf-8"))
METHODS = {"get", "post", "put", "patch", "delete"}


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.now


def dev_settings(**overrides: object) -> ApiSettings:
    values: dict[str, object] = {
        "env": "development",
        "dev_auth": True,
        "fake_auth": False,
        "session_secret": SECRET,
        "read_credential": SYNTHETIC_READ_CREDENTIAL,
    }
    values.update(overrides)
    return ApiSettings(**values)  # type: ignore[arg-type]


def client_app(settings: ApiSettings | None = None, **kwargs: object) -> tuple[TestClient, object]:
    app = create_app(settings or dev_settings(), environ={}, **kwargs)  # type: ignore[arg-type]
    return TestClient(app), app


def login(client: TestClient, label: str = "dev-browser") -> str:
    response = client.post(
        "/api/session/login",
        json={"username": "synthetic", "password": "synthetic", "device_label": label},
    )
    assert response.status_code == 200
    header = response.headers["set-cookie"]
    lowered = header.lower()
    assert "httponly" in lowered
    assert "secure" in lowered
    assert "samesite=lax" in lowered
    token = header.split(";", 1)[0]
    name, value = token.split("=", 1)
    assert name == COOKIE_NAME
    assert response.json()["device_id"]
    assert "synthetic-read" not in response.text
    return value


def test_contract_paths_match_the_app() -> None:
    client, _app = client_app()
    live = client.app.openapi()
    assert set(live["paths"]) == set(CONTRACT["paths"])
    for path, operations in CONTRACT["paths"].items():
        expected = {method for method in operations if method in METHODS}
        actual = {method for method in live["paths"][path] if method in METHODS}
        assert actual == expected
        if path.startswith("/api/session"):
            continue
        if path == "/api/tasks":
            assert expected == {"get", "post"}
            continue
        if path == "/api/tasks/{id}":
            assert expected == {"get", "patch"}
            continue
        if path in {"/api/tasks/{id}/complete", "/api/tasks/{id}/reopen"}:
            assert expected == {"post"}
            continue
        assert expected == {"get"}
    blob = json.dumps(live)
    for banned in ("/sql", "/export", "/download", "raw-sql"):
        assert banned not in blob
    described = json.dumps(CONTRACT["servers"])
    assert "Next.js" in described
    assert "FastAPI" in described
    assert "/api/finance/accounts" in CONTRACT["paths"]
    assert "/finance/accounts" not in CONTRACT["paths"]


def test_domain_writes_are_rejected() -> None:
    client, _app = client_app()
    cookie = login(client)
    response = client.post("/api/finance/accounts", cookies={COOKIE_NAME: cookie}, json={})
    assert response.status_code == 405


def test_login_cookie_session_logout_and_revoke() -> None:
    client, app = client_app()
    denied = client.get("/api/finance/accounts")
    assert denied.status_code == 401
    cookie = login(client)
    accounts = client.get("/api/finance/accounts", cookies={COOKIE_NAME: cookie})
    assert accounts.status_code == 200
    assert accounts.json()[0]["name"] == "Sample Checking"
    assert accounts.headers["cache-control"] == "no-store"
    devices = client.get("/api/session/devices", cookies={COOKIE_NAME: cookie})
    assert devices.status_code == 200
    listed = devices.json()
    assert listed[0]["label"] == "dev-browser"
    assert "session_id" not in listed[0]
    other = login(client, label="second")
    listed = client.get("/api/session/devices", cookies={COOKIE_NAME: other}).json()
    first = next(row for row in listed if row["label"] == "dev-browser")
    revoked = client.post(f"/api/session/devices/{first['id']}/revoke", cookies={COOKIE_NAME: other})
    assert revoked.status_code == 200
    assert client.get("/api/finance/accounts", cookies={COOKIE_NAME: cookie}).status_code == 401
    assert client.get("/api/finance/accounts", cookies={COOKIE_NAME: other}).status_code == 200
    logged_out = client.post("/api/session/logout", cookies={COOKIE_NAME: other})
    assert logged_out.status_code == 200
    assert "joehub_session" in logged_out.headers["set-cookie"].lower()
    assert client.get("/api/journal/entries", cookies={COOKIE_NAME: other}).status_code == 401
    missing = client.post("/api/session/devices/missing/revoke", cookies={COOKIE_NAME: cookie})
    assert missing.status_code == 401


def test_expiry_is_fixed_for_fourteen_days() -> None:
    clock = Clock()
    client, app = client_app(clock=clock)
    cookie = login(client)
    session_id = cookie.split(".", 1)[0]
    record = app.state.sessions.sessions[session_id]
    assert record.expires_at - record.created_at == timedelta(days=SESSION_DAYS)
    clock.now += timedelta(days=13)
    assert client.get("/api/jobs/applications", cookies={COOKIE_NAME: cookie}).status_code == 200
    assert record.expires_at - record.created_at == timedelta(days=SESSION_DAYS)
    clock.now += timedelta(days=2)
    assert client.get("/api/jobs/applications", cookies={COOKIE_NAME: cookie}).status_code == 401


def test_rate_limits_login_and_reads() -> None:
    client, _app = client_app(login_limit=2, api_limit=2)
    assert client.post("/api/session/login", json={"username": "nope", "password": "nope"}).status_code == 401
    assert client.post("/api/session/login", json={"username": "nope", "password": "nope"}).status_code == 401
    blocked = client.post(
        "/api/session/login",
        json={"username": "synthetic", "password": "synthetic"},
    )
    assert blocked.status_code == 429
    fresh, _app = client_app(login_limit=5, api_limit=2)
    cookie = login(fresh)
    assert fresh.get("/api/finance/transactions", cookies={COOKIE_NAME: cookie}).status_code == 200
    assert fresh.get("/api/finance/transactions", cookies={COOKIE_NAME: cookie}).status_code == 200
    assert fresh.get("/api/finance/transactions", cookies={COOKIE_NAME: cookie}).status_code == 429


def test_logs_omit_row_data(caplog: pytest.LogCaptureFixture) -> None:
    client, _app = client_app()
    cookie = login(client)
    caplog.set_level(logging.INFO, logger="joehub_api.access")
    response = client.get("/api/finance/transactions", cookies={COOKIE_NAME: cookie})
    assert response.status_code == 200
    assert "SYNTHETIC-ACORN-PAYEE" in response.text
    messages = " ".join(
        record.getMessage() for record in caplog.records if record.name == "joehub_api.access"
    )
    assert "/api/finance/transactions" in messages
    assert "SYNTHETIC-ACORN-PAYEE" not in messages
    assert SECRET not in messages


def test_dev_login_disabled_without_the_flag() -> None:
    app = create_app(dev_settings(dev_auth=False), environ={})
    client = TestClient(app)
    response = client.post(
        "/api/session/login",
        json={"username": "synthetic", "password": "synthetic"},
    )
    assert response.status_code == 404


def test_production_refuses_dev_auth_and_missing_secret() -> None:
    with pytest.raises(StartupError, match="refusing to start"):
        create_app(dev_settings(env="production", dev_auth=True), environ={})
    with pytest.raises(StartupError, match="refusing to start"):
        create_app(
            dev_settings(env="production", dev_auth=False, fake_auth=True, session_secret=SECRET),
            environ={},
        )
    with pytest.raises(StartupError, match="refusing to start"):
        create_app(
            dev_settings(env="production", dev_auth=False, session_secret=""),
            environ={},
        )
    with pytest.raises(StartupError, match="refusing to start"):
        create_app(
            dev_settings(
                env="production",
                dev_auth=False,
                session_secret=SECRET,
                read_credential="x" * MIN_SECRET_LENGTH,
            ),
            environ={"JOEHUB_DB_PATH": "/tmp/joehub.db"},
        )
    with pytest.raises(StartupError, match="refusing to start"):
        create_app(
            dev_settings(env="production", dev_auth=False, session_secret=SECRET, read_credential=SECRET),
            environ={"JOEHUB_OPERATOR_TOKEN": "nope"},
        )
    with pytest.raises(StartupError, match="refusing to start"):
        ApiSettings.from_env(
            {
                "JOEHUB_API_ENV": "production",
                "JOEHUB_SESSION_SECRET": SECRET,
                "JOEHUB_READ_CREDENTIAL": SECRET,
                "JOEHUB_AGE_IDENTITY": "/tmp/age.txt",
            }
        ).check(
            {
                "JOEHUB_API_ENV": "production",
                "JOEHUB_SESSION_SECRET": SECRET,
                "JOEHUB_READ_CREDENTIAL": SECRET,
                "JOEHUB_AGE_IDENTITY": "/tmp/age.txt",
            }
        )


def test_production_starts_without_dev_login() -> None:
    app = create_app(
        dev_settings(
            env="production",
            dev_auth=False,
            session_secret=SECRET,
            read_credential="scoped-read-credential",
        ),
        environ={},
    )
    client = TestClient(app)
    response = client.post(
        "/api/session/login",
        json={"username": "synthetic", "password": "synthetic"},
    )
    assert response.status_code == 404


def test_wrong_read_credential_returns_no_rows() -> None:
    from joehub_api.read_source import SyntheticReadSource

    app = create_app(
        dev_settings(),
        environ={},
        source=SyntheticReadSource("other-read-credential"),
    )
    client = TestClient(app)
    cookie = login(client)
    response = client.get("/api/finance/accounts", cookies={COOKIE_NAME: cookie})
    assert response.status_code == 503
    assert "Sample Checking" not in response.text
    assert "SYNTHETIC-ACORN-PAYEE" not in response.text


def test_http_contract_is_json_and_matches_fixtures() -> None:
    client, _app = client_app()
    cookie = login(client)
    fixtures = json.loads((REPO / "contract" / "fixtures.json").read_text(encoding="utf-8"))
    mapping = {
        "/api/finance/accounts": "accounts",
        "/api/finance/transactions": "transactions",
        "/api/jobs/applications": "applications",
        "/api/jobs/statuses": "statuses",
        "/api/journal/entries": "entries",
        "/api/journal/events": "events",
    }
    for path, key in mapping.items():
        response = client.get(path, cookies={COOKIE_NAME: cookie})
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/json")
        assert response.json() == fixtures[key]
    unprefixed = client.get("/finance/accounts", cookies={COOKIE_NAME: cookie})
    assert unprefixed.status_code == 404
    assert unprefixed.json() != fixtures["accounts"]


def test_unicode_and_malformed_auth_are_not_server_errors() -> None:
    client, _app = client_app()
    username = client.post(
        "/api/session/login",
        json={"username": "synthétic", "password": "synthetic"},
    )
    assert username.status_code == 401
    password = client.post(
        "/api/session/login",
        json={"username": "synthetic", "password": "synthétic"},
    )
    assert password.status_code == 401
    nested = client.post(
        "/api/session/login",
        json={"username": ["synthetic"], "password": "synthetic"},
    )
    assert nested.status_code == 400
    raw = client.post(
        "/api/session/login",
        content=b"\xff",
        headers={"content-type": "application/json"},
    )
    assert raw.status_code == 400
    broken = client.post(
        "/api/session/login",
        content=b"{",
        headers={"content-type": "application/json"},
    )
    assert broken.status_code == 400
    for response in (username, password, nested, raw, broken):
        assert response.status_code < 500
    cookie = login(client)
    weird = cookie.split(".", 1)[0] + "." + ("é" * 64)
    assert client.app.state.sessions.resolve(weird) is None
    still = client.get("/api/finance/accounts", cookies={COOKIE_NAME: cookie})
    assert still.status_code == 200


def test_spoofed_forwarded_for_does_not_bypass_the_limit() -> None:
    client, _app = client_app(login_limit=2)
    for hop in ("1.1.1.1", "2.2.2.2"):
        response = client.post(
            "/api/session/login",
            json={"username": "nope", "password": "nope"},
            headers={"x-forwarded-for": hop},
        )
        assert response.status_code == 401
    blocked = client.post(
        "/api/session/login",
        json={"username": "nope", "password": "nope"},
        headers={"x-forwarded-for": "3.3.3.3"},
    )
    assert blocked.status_code == 429


def test_trusted_proxy_may_use_forwarded_for() -> None:
    client, _app = client_app(
        settings=dev_settings(trusted_proxies=frozenset({"testclient"})),
        login_limit=1,
    )
    first = client.post(
        "/api/session/login",
        json={"username": "nope", "password": "nope"},
        headers={"x-forwarded-for": "1.1.1.1"},
    )
    second = client.post(
        "/api/session/login",
        json={"username": "nope", "password": "nope"},
        headers={"x-forwarded-for": "2.2.2.2"},
    )
    assert first.status_code == 401
    assert second.status_code == 401


def test_tasks_require_a_session_and_create_once() -> None:
    client, _app = client_app()
    assert client.get("/api/tasks").status_code == 401
    assert client.post("/api/tasks", json={"title": "Nope"}).status_code == 401
    cookie = login(client)
    blank = client.post("/api/tasks", json={"title": "   "}, cookies={COOKIE_NAME: cookie})
    assert blank.status_code == 400
    assert blank.json()["field"] == "title"
    headers = {"Idempotency-Key": "task-key-1"}
    payload = {"title": "Sample task", "status": "Doing", "priority": "Low"}
    first = client.post("/api/tasks", json=payload, headers=headers, cookies={COOKIE_NAME: cookie})
    second = client.post("/api/tasks", json=payload, headers=headers, cookies={COOKIE_NAME: cookie})
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    listed = client.get("/api/tasks", cookies={COOKIE_NAME: cookie})
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json() if row["title"] == "Sample task"] == [first.json()["id"]]
    done = client.post("/api/tasks", json={"title": "Finished", "status": "Done"}, cookies={COOKIE_NAME: cookie})
    assert done.status_code == 400


def test_task_patch_persists_and_keeps_the_copy_on_failure() -> None:
    from joehub_api.tasks import TaskStore, detroit_calendar_date

    after_utc_midnight = int(datetime(2026, 11, 10, 0, 30, tzinfo=timezone.utc).timestamp() * 1000)
    before_detroit = int(datetime(2026, 11, 10, 4, 59, tzinfo=timezone.utc).timestamp() * 1000)
    after_detroit = int(datetime(2026, 11, 10, 5, 1, tzinfo=timezone.utc).timestamp() * 1000)
    assert detroit_calendar_date(after_utc_midnight) == "2026-11-09"
    assert detroit_calendar_date(before_detroit) == "2026-11-09"
    assert detroit_calendar_date(after_detroit) == "2026-11-10"
    clock = {"now": after_utc_midnight}
    store = TaskStore(clock=lambda: clock["now"])
    _status, created = store.create(
        {"title": "Edit me", "notes": "Keep", "dueDate": "2026-11-20", "priority": "High", "project": "Home"},
        None,
    )
    clock["now"] = after_utc_midnight + 25
    status, patched = store.patch(created["id"], {"dueDate": "today", "notes": None, "priority": None, "project": None})
    assert status == 200
    assert patched["dueDate"] == "2026-11-09"
    assert "notes" not in patched and "priority" not in patched and "project" not in patched
    assert patched["updatedAt"] > created["updatedAt"]
    for field in ("id", "createdAt", "updatedAt", "completedAt", "nope"):
        status, body = store.patch(created["id"], {field: "x", "title": "Ignored"})
        assert status == 400
        assert body["field"] == field
        assert field in body["detail"]
    assert store.get(created["id"])[1]["title"] == "Edit me"

    client, _app = client_app()
    assert client.get("/api/tasks/missing-task").status_code == 401
    assert client.patch("/api/tasks/missing-task", json={"title": "Nope"}).status_code == 401
    cookie = login(client)
    created_response = client.post(
        "/api/tasks",
        json={"title": "Edit me", "notes": "Keep", "dueDate": "2026-11-20", "priority": "High", "project": "Home", "status": "Doing"},
        cookies={COOKIE_NAME: cookie},
    )
    assert created_response.status_code == 201
    task_id = created_response.json()["id"]
    edited = client.patch(
        f"/api/tasks/{task_id}",
        json={"title": "Edited", "status": "Blocked"},
        cookies={COOKIE_NAME: cookie},
    )
    assert edited.status_code == 200
    assert edited.json()["title"] == "Edited"
    assert edited.json()["updatedAt"] > created_response.json()["updatedAt"]
    cleared = client.patch(
        f"/api/tasks/{task_id}",
        json={"notes": None, "dueDate": None, "priority": None, "project": None},
        cookies={COOKIE_NAME: cookie},
    )
    assert cleared.status_code == 200
    assert "notes" not in cleared.json()
    assert "dueDate" not in cleared.json()
    blank = client.patch(f"/api/tasks/{task_id}", json={"title": "   "}, cookies={COOKIE_NAME: cookie})
    assert blank.status_code == 400
    assert blank.json()["field"] == "title"
    done = client.patch(f"/api/tasks/{task_id}", json={"status": "Done"}, cookies={COOKIE_NAME: cookie})
    assert done.status_code == 400
    for field in ("id", "createdAt", "updatedAt", "completedAt", "mystery"):
        rejected = client.patch(
            f"/api/tasks/{task_id}",
            json={field: "nope", "title": "Should stay"},
            cookies={COOKIE_NAME: cookie},
        )
        assert rejected.status_code == 400
        assert rejected.json()["field"] == field
        assert field in rejected.json()["detail"]
    stored_mid = client.get(f"/api/tasks/{task_id}", cookies={COOKIE_NAME: cookie})
    assert stored_mid.json()["title"] == "Edited"
    assert stored_mid.json()["id"] == task_id
    missing = client.patch("/api/tasks/missing-task", json={"title": "Nope"}, cookies={COOKIE_NAME: cookie})
    assert missing.status_code == 404
    stored = client.get(f"/api/tasks/{task_id}", cookies={COOKIE_NAME: cookie})
    assert stored.status_code == 200
    assert stored.json()["title"] == "Edited"
    assert stored.json()["status"] == "Blocked"
    assert "notes" not in stored.json()


def test_complete_search_reopen_and_purge() -> None:
    from joehub_api.tasks import DONE_WINDOW_MS, TaskStore

    now = 1_800_000_000_000
    clock = {"now": now}
    store = TaskStore(clock=lambda: clock["now"])
    _status, keep = store.create({"title": "Keep the sample list", "project": "Home"}, None)
    _status, done = store.create({"title": "Finish the sample card", "notes": "Alpha note", "project": "Work"}, None)
    clock["now"] = now + 1000
    status, completed = store.complete(done["id"])
    assert status == 200
    assert completed["status"] == "Done"
    assert completed["completedAt"] == now + 1000
    assert store.complete("missing-task")[0] == 404
    clock["now"] = now + 6 * 24 * 60 * 60 * 1000
    assert all(task["id"] != done["id"] for task in store.list_unfinished())
    found = store.search("ALPHA")
    assert [task["id"] for task in found] == [done["id"]]
    assert store.search("work")[0]["status"] == "Done"
    status, reopened = store.reopen(done["id"])
    assert status == 200
    assert reopened["status"] == "To do"
    assert "completedAt" not in reopened
    assert any(task["id"] == done["id"] for task in store.list_unfinished())
    clock["now"] = now + 2000
    store.complete(done["id"])
    clock["now"] = now + 2000 + DONE_WINDOW_MS + 1
    assert store.search("alpha") == []
    assert store.get(done["id"])[0] == 404
    assert any(task["id"] == keep["id"] for task in store.list_unfinished())

    client, _app = client_app()
    assert client.post("/api/tasks/missing-task/complete").status_code == 401
    assert client.post("/api/tasks/missing-task/reopen").status_code == 401
    cookie = login(client)
    created = client.post("/api/tasks", json={"title": "Searchable sample", "notes": "Needle"}, cookies={COOKIE_NAME: cookie})
    assert created.status_code == 201
    task_id = created.json()["id"]
    finished = client.post(f"/api/tasks/{task_id}/complete", cookies={COOKIE_NAME: cookie})
    assert finished.status_code == 200
    assert finished.json()["status"] == "Done"
    listed = client.get("/api/tasks", cookies={COOKIE_NAME: cookie})
    assert all(task["id"] != task_id for task in listed.json())
    found_http = client.get("/api/tasks", params={"q": "needle"}, cookies={COOKIE_NAME: cookie})
    assert found_http.status_code == 200
    assert any(task["id"] == task_id and task["status"] == "Done" for task in found_http.json())
    reopened_http = client.post(f"/api/tasks/{task_id}/reopen", cookies={COOKIE_NAME: cookie})
    assert reopened_http.status_code == 200
    assert reopened_http.json()["status"] == "To do"
    assert "completedAt" not in reopened_http.json()
    back = client.get("/api/tasks", cookies={COOKIE_NAME: cookie})
    assert any(task["id"] == task_id and task["status"] == "To do" for task in back.json())
    assert client.post("/api/tasks/missing-task/complete", cookies={COOKIE_NAME: cookie}).status_code == 404
    assert client.post("/api/tasks/missing-task/reopen", cookies={COOKIE_NAME: cookie}).status_code == 404
