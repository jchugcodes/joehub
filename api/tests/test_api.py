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


def client_app(**kwargs: object) -> tuple[TestClient, object]:
    app = create_app(dev_settings(), environ={}, **kwargs)  # type: ignore[arg-type]
    return TestClient(app), app


def login(client: TestClient, label: str = "dev-browser") -> str:
    response = client.post(
        "/session/login",
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
        if path.startswith("/session"):
            continue
        assert expected == {"get"}
    blob = json.dumps(live)
    for banned in ("/sql", "/export", "/download", "raw-sql"):
        assert banned not in blob


def test_domain_writes_are_rejected() -> None:
    client, _app = client_app()
    cookie = login(client)
    response = client.post("/finance/accounts", cookies={COOKIE_NAME: cookie}, json={})
    assert response.status_code == 405


def test_login_cookie_session_logout_and_revoke() -> None:
    client, app = client_app()
    denied = client.get("/finance/accounts")
    assert denied.status_code == 401
    cookie = login(client)
    accounts = client.get("/finance/accounts", cookies={COOKIE_NAME: cookie})
    assert accounts.status_code == 200
    assert accounts.json()[0]["name"] == "Sample Checking"
    assert accounts.headers["cache-control"] == "no-store"
    devices = client.get("/session/devices", cookies={COOKIE_NAME: cookie})
    assert devices.status_code == 200
    listed = devices.json()
    assert listed[0]["label"] == "dev-browser"
    assert "session_id" not in listed[0]
    other = login(client, label="second")
    listed = client.get("/session/devices", cookies={COOKIE_NAME: other}).json()
    first = next(row for row in listed if row["label"] == "dev-browser")
    revoked = client.post(f"/session/devices/{first['id']}/revoke", cookies={COOKIE_NAME: other})
    assert revoked.status_code == 200
    assert client.get("/finance/accounts", cookies={COOKIE_NAME: cookie}).status_code == 401
    assert client.get("/finance/accounts", cookies={COOKIE_NAME: other}).status_code == 200
    logged_out = client.post("/session/logout", cookies={COOKIE_NAME: other})
    assert logged_out.status_code == 200
    assert "joehub_session" in logged_out.headers["set-cookie"].lower()
    assert client.get("/journal/entries", cookies={COOKIE_NAME: other}).status_code == 401
    missing = client.post("/session/devices/missing/revoke", cookies={COOKIE_NAME: cookie})
    assert missing.status_code == 401


def test_expiry_is_fixed_for_fourteen_days() -> None:
    clock = Clock()
    client, app = client_app(clock=clock)
    cookie = login(client)
    session_id = cookie.split(".", 1)[0]
    record = app.state.sessions.sessions[session_id]
    assert record.expires_at - record.created_at == timedelta(days=SESSION_DAYS)
    clock.now += timedelta(days=13)
    assert client.get("/jobs/applications", cookies={COOKIE_NAME: cookie}).status_code == 200
    assert record.expires_at - record.created_at == timedelta(days=SESSION_DAYS)
    clock.now += timedelta(days=2)
    assert client.get("/jobs/applications", cookies={COOKIE_NAME: cookie}).status_code == 401


def test_rate_limits_login_and_reads() -> None:
    client, _app = client_app(login_limit=2, api_limit=2)
    assert client.post("/session/login", json={"username": "nope", "password": "nope"}).status_code == 401
    assert client.post("/session/login", json={"username": "nope", "password": "nope"}).status_code == 401
    blocked = client.post(
        "/session/login",
        json={"username": "synthetic", "password": "synthetic"},
    )
    assert blocked.status_code == 429
    fresh, _app = client_app(login_limit=5, api_limit=2)
    cookie = login(fresh)
    assert fresh.get("/finance/transactions", cookies={COOKIE_NAME: cookie}).status_code == 200
    assert fresh.get("/finance/transactions", cookies={COOKIE_NAME: cookie}).status_code == 200
    assert fresh.get("/finance/transactions", cookies={COOKIE_NAME: cookie}).status_code == 429


def test_logs_omit_row_data(caplog: pytest.LogCaptureFixture) -> None:
    client, _app = client_app()
    cookie = login(client)
    caplog.set_level(logging.INFO, logger="joehub_api.access")
    response = client.get("/finance/transactions", cookies={COOKIE_NAME: cookie})
    assert response.status_code == 200
    assert "SYNTHETIC-ACORN-PAYEE" in response.text
    messages = " ".join(
        record.getMessage() for record in caplog.records if record.name == "joehub_api.access"
    )
    assert "/finance/transactions" in messages
    assert "SYNTHETIC-ACORN-PAYEE" not in messages
    assert SECRET not in messages


def test_dev_login_disabled_without_the_flag() -> None:
    app = create_app(dev_settings(dev_auth=False), environ={})
    client = TestClient(app)
    response = client.post(
        "/session/login",
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
        "/session/login",
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
    response = client.get("/finance/accounts", cookies={COOKIE_NAME: cookie})
    assert response.status_code == 503
    assert "Sample Checking" not in response.text
    assert "SYNTHETIC-ACORN-PAYEE" not in response.text
