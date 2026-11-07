from __future__ import annotations

import os
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
from tests.acting import credential


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


def test_source_checkout_is_the_code_root(monkeypatch):
    from joehub.config import assert_outside_repo, repo_roots

    roots = repo_roots()
    checkout = Path(os.path.realpath(Path(__file__).resolve().parents[1]))
    assert checkout in roots
    assert checkout.parent not in roots
    assert (checkout / "pyproject.toml").is_file()
    assert (checkout / "migrations").is_dir()
    assert (checkout / ".git").exists()
    with pytest.raises(ConfigError):
        assert_outside_repo(checkout / "joehub.db")
    for name in ("JOEHUB_DB_PATH", "JOEHUB_EXPORT_DIR", "JOEHUB_KEY_DIR", "JOEHUB_AUTH_HASH_FILE"):
        monkeypatch.delenv(name, raising=False)
    settings = load_settings()
    assert settings.db_path == DEFAULT_DB_PATH
    assert settings.export_dir == DEFAULT_EXPORT_DIR
    assert settings.key_dir == DEFAULT_KEY_DIR
    for path in (settings.db_path, settings.export_dir, settings.key_dir):
        assert not Path(os.path.realpath(path)).is_relative_to(checkout)


def _tarball_release(tmp_path: Path) -> dict[str, Path]:
    """A release directory with no .git, plus the parent layout around it."""
    base = tmp_path / "home" / "box" / "joehub"
    release = base / "releases" / "5e3a05c"
    (release / "migrations").mkdir(parents=True)
    (release / "pyproject.toml").write_text("[project]\nname = 'joehub'\n", encoding="utf-8")
    package = release / "src" / "joehub"
    package.mkdir(parents=True)
    (package / "config.py").write_text("# tarball\n", encoding="utf-8")
    (base / ".git").mkdir()
    sibling = base / "releases" / "5e3a05c-other"
    sibling.mkdir()
    current = base / "current"
    current.symlink_to(release, target_is_directory=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    into_release = outside / "db-link"
    into_release.symlink_to(release / "inside.db")
    return {
        "base": base,
        "release": release,
        "package": package / "config.py",
        "sibling": sibling,
        "current": current,
        "into_release": into_release,
    }


def test_tarball_release_symlink_sibling_and_defaults(tmp_path, monkeypatch):
    from joehub.config import repo_roots

    layout = _tarball_release(tmp_path)
    release = layout["release"]
    base = layout["base"]
    assert not (release / ".git").exists()
    monkeypatch.setattr("joehub.config._code_root_starts", lambda: [layout["package"]])
    roots = repo_roots()
    release_real = Path(os.path.realpath(release))
    assert roots == [release_real]
    assert Path(os.path.realpath(base)) not in roots
    assert Path(os.path.realpath(base.parent)) not in roots

    monkeypatch.setenv("JOEHUB_EXPORT_DIR", str(base / "exports"))
    monkeypatch.setenv("JOEHUB_KEY_DIR", str(base / "keys"))
    monkeypatch.setenv("JOEHUB_DB_PATH", str(release / "joehub.db"))
    with pytest.raises(ConfigError):
        load_settings()

    monkeypatch.setenv("JOEHUB_DB_PATH", str(layout["current"] / "joehub.db"))
    with pytest.raises(ConfigError):
        load_settings()
    current_real = Path(os.path.realpath(layout["current"] / "joehub.db"))
    assert current_real.is_relative_to(release_real)

    monkeypatch.setenv("JOEHUB_DB_PATH", str(layout["into_release"]))
    with pytest.raises(ConfigError):
        load_settings()
    assert Path(os.path.realpath(layout["into_release"])).is_relative_to(release_real)

    sibling = layout["sibling"]
    sibling_db = sibling / "joehub.db"
    assert str(sibling).startswith(str(release))
    assert not Path(os.path.realpath(sibling)).is_relative_to(release_real)
    monkeypatch.setenv("JOEHUB_DB_PATH", str(sibling_db))
    settings = load_settings()
    assert settings.db_path == sibling_db

    monkeypatch.setenv("JOEHUB_DB_PATH", str(base / "data" / "joehub.db"))
    settings = load_settings()
    assert settings.db_path == base / "data" / "joehub.db"
    assert not Path(os.path.realpath(settings.db_path)).is_relative_to(release_real)

    for name in ("JOEHUB_DB_PATH", "JOEHUB_EXPORT_DIR", "JOEHUB_KEY_DIR", "JOEHUB_AUTH_HASH_FILE"):
        monkeypatch.delenv(name, raising=False)
    settings = load_settings()
    assert settings.db_path == Path("/home/box/joehub/data/joehub.db")
    assert settings.export_dir == Path("/home/box/joehub/exports")
    assert settings.key_dir == Path("/home/box/.config/joehub/keys")
    for path in (settings.db_path, settings.export_dir, settings.key_dir):
        assert not Path(os.path.realpath(path)).is_relative_to(release_real)


def test_missing_code_root_fails_closed(tmp_path, monkeypatch):
    from joehub.config import repo_roots

    empty = tmp_path / "not-a-release"
    empty.mkdir()
    (empty / ".git").mkdir()
    (empty / "pyproject.toml").write_text("[project]\nname = 'nope'\n", encoding="utf-8")
    monkeypatch.setattr("joehub.config._code_root_starts", lambda: [empty])
    with pytest.raises(ConfigError, match="code root"):
        repo_roots()
    with pytest.raises(ConfigError, match="code root"):
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
        credential=credential(settings, "Ledger"),
        table="accounts",
        operation="insert",
        payload={"name": "Action Checking", "account_type": "checking"},
        idempotency_key="action-acct",
        settings=settings,
    )
    assert err is None and account is not None
    saved, err = perform(
        credential=credential(settings, "Ledger"),
        table="transactions",
        operation="insert",
        payload={"account_id": account.row_id, "amount_cents": -500, "date": "2026-05-01", "payee": "Corner"},
        idempotency_key="action-tx",
        settings=settings,
    )
    assert err is None and saved is not None
    _none, meta_err = perform(
        credential=credential(settings, "Cato"),
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
