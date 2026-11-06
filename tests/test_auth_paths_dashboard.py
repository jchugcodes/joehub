from __future__ import annotations

from pathlib import Path

import pytest

from joehub.actions import perform
from joehub.auth import hash_password, load_password_hash, verify_password
from joehub.config import (
    DEFAULT_BIND_ADDRESS,
    DEFAULT_DB_PATH,
    DEFAULT_EXPORT_DIR,
    DEFAULT_KEY_DIR,
    load_settings,
)
from joehub.errors import AuthConfigError, ConfigError, ValidationError
from joehub.money import dollars_to_cents, format_cents
from joehub.queries import inspect_table, net_worth_cents, recent_transactions
from joehub.db import connect
from joehub.principals import token_for


def test_default_paths_are_outside_the_repo(monkeypatch):
    for name in (
        "JOEHUB_DB_PATH",
        "JOEHUB_EXPORT_DIR",
        "JOEHUB_KEY_DIR",
        "JOEHUB_AUTH_HASH",
        "JOEHUB_AUTH_HASH_FILE",
        "JOEHUB_BIND_ADDRESS",
    ):
        monkeypatch.delenv(name, raising=False)
    settings = load_settings()
    assert settings.db_path == DEFAULT_DB_PATH == Path("/home/box/joehub/data/joehub.db")
    assert settings.export_dir == DEFAULT_EXPORT_DIR == Path("/home/box/joehub/exports")
    assert settings.key_dir == DEFAULT_KEY_DIR == Path("/home/box/.config/joehub/keys")
    assert settings.bind_address == DEFAULT_BIND_ADDRESS == "127.0.0.1"
    repo = Path(__file__).resolve().parents[1]
    assert not settings.db_path.is_relative_to(repo)
    assert not settings.export_dir.is_relative_to(repo)
    assert not settings.key_dir.is_relative_to(repo)


def test_repo_paths_are_rejected(monkeypatch):
    monkeypatch.setenv("JOEHUB_DB_PATH", str(Path.cwd() / "joehub.db"))
    with pytest.raises(ConfigError):
        load_settings()


def test_password_hash_round_trip_and_missing_config(tmp_path, monkeypatch):
    stored = hash_password("correct horse battery")
    assert verify_password("correct horse battery", stored)
    assert not verify_password("nope", stored)
    assert "correct horse battery" not in stored
    with pytest.raises(ValidationError):
        hash_password("")
    monkeypatch.delenv("JOEHUB_AUTH_HASH", raising=False)
    monkeypatch.setenv("JOEHUB_AUTH_HASH_FILE", str(tmp_path / "missing"))
    with pytest.raises(AuthConfigError):
        load_password_hash()
    monkeypatch.setenv("JOEHUB_AUTH_HASH", stored)
    assert load_password_hash() == stored


def test_money_and_queries_and_actions(writer, settings):
    assert dollars_to_cents("-12.34") == -1234
    assert dollars_to_cents("10") == 1000
    assert format_cents(-1234) == "-$12.34"
    with pytest.raises(ValidationError):
        dollars_to_cents("10.555")
    account, err = perform(
        credential=token_for(settings, "Ledger"),
        table="accounts",
        operation="insert",
        payload={"name": "Action Checking", "account_type": "checking"},
        idempotency_key="action-acct",
        settings=settings,
    )
    assert err is None and account is not None
    saved, err = perform(
        credential=token_for(settings, "Ledger"),
        table="transactions",
        operation="insert",
        payload={"account_id": account.row_id, "amount_cents": -500, "date": "2026-05-01", "payee": "Corner"},
        idempotency_key="action-tx",
        settings=settings,
    )
    assert err is None and saved is not None
    _none, meta_err = perform(
        credential=token_for(settings, "Cato"),
        table="locks",
        operation="insert",
        payload={"id": "nope"},
        idempotency_key="action-lock",
        settings=settings,
    )
    assert meta_err
    conn = connect(settings.db_path)
    try:
        assert net_worth_cents(conn) == -500
        recent = recent_transactions(conn)
        assert recent[0]["payee"] == "Corner"
        found = inspect_table(conn, "transactions", search="Corner")
        assert len(found) == 1
        assert inspect_table(conn, "transactions", search="zzzz") == []
    finally:
        conn.close()


def test_dashboard_pages_authenticate_and_use_the_write_layer():
    root = Path(__file__).resolve().parents[1]
    pages = list((root / "src" / "joehub" / "dashboard" / "pages").glob("*.py"))
    assert len(pages) == 4
    for path in pages:
        text = path.read_text(encoding="utf-8")
        assert "require_auth(" in text
        assert "perform(" in text
        assert "credential=session_credential()" in text
        assert "joehub_auth" not in text
        assert "INSERT " not in text
        assert "DELETE " not in text
    common = (root / "src" / "joehub" / "dashboard" / "common.py").read_text(encoding="utf-8")
    assert "joehub_principal" in common
    assert "joehub_auth" not in common
    config = (root / ".streamlit" / "config.toml").read_text(encoding="utf-8")
    assert 'address = "127.0.0.1"' in config
    runner = (root / "scripts" / "run_dashboard.py").read_text(encoding="utf-8")
    assert "server.address" in runner
