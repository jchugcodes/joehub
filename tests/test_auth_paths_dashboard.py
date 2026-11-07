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
    from joehub.config import repo_roots

    monkeypatch.setenv("JOEHUB_DB_PATH", str(repo_roots()[0] / "joehub.db"))
    with pytest.raises(ConfigError):
        load_settings()


def _project_tree(path: Path, *, git: bool) -> Path:
    """A synthetic project. Returns the package ``__init__.py`` inside it."""
    (path / "migrations").mkdir(parents=True)
    (path / "pyproject.toml").write_text("[project]\nname = 'joehub'\n", encoding="utf-8")
    package = path / "src" / "joehub"
    package.mkdir(parents=True)
    init = package / "__init__.py"
    init.write_text("# synthetic\n", encoding="utf-8")
    if git:
        (path / ".git").mkdir()
    return init


def _bind_package(monkeypatch, init: Path) -> None:
    import joehub

    monkeypatch.setattr(joehub, "__file__", str(init))


def test_synthetic_checkout_is_a_code_root(tmp_path, monkeypatch):
    from joehub.config import assert_outside_repo, repo_roots

    checkout = tmp_path / "checkout"
    init = _project_tree(checkout, git=True)
    unrelated = tmp_path / "unrelated"
    unrelated.mkdir()
    _bind_package(monkeypatch, init)
    monkeypatch.chdir(unrelated)
    roots = repo_roots()
    checkout_real = Path(os.path.realpath(checkout))
    assert roots == [checkout_real]
    assert checkout_real.parent not in roots
    assert (checkout_real / ".git").is_dir()
    assert (checkout_real / "pyproject.toml").is_file()
    assert (checkout_real / "migrations").is_dir()
    with pytest.raises(ConfigError):
        assert_outside_repo(checkout_real / "joehub.db")
    assert_outside_repo(unrelated / "joehub.db")


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
    _bind_package(monkeypatch, layout["package"])
    decoy = tmp_path / "unrelated-cwd"
    _project_tree(decoy, git=False)
    monkeypatch.chdir(decoy)
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


def test_unrelated_cwd_cannot_mask_a_missing_package_root(tmp_path, monkeypatch):
    from joehub.config import repo_roots

    installed = tmp_path / "site-packages" / "joehub"
    installed.mkdir(parents=True)
    init = installed / "__init__.py"
    init.write_text("# installed without the project tree\n", encoding="utf-8")
    (installed.parent / ".git").mkdir()
    decoy = tmp_path / "other-project"
    _project_tree(decoy, git=True)
    _bind_package(monkeypatch, init)
    monkeypatch.chdir(decoy)
    with pytest.raises(ConfigError, match="code root"):
        repo_roots()
    with pytest.raises(ConfigError, match="code root"):
        load_settings()


def test_real_package_anchor_ignores_unrelated_cwd(tmp_path, monkeypatch):
    import joehub
    from joehub.config import assert_outside_repo, repo_roots

    decoy = tmp_path / "unrelated"
    _project_tree(decoy, git=True)
    monkeypatch.chdir(decoy)
    roots = repo_roots()
    package = Path(os.path.realpath(joehub.__file__))
    expected = package.parent
    while expected.parent != expected:
        if (expected / "pyproject.toml").is_file() and (expected / "migrations").is_dir():
            break
        expected = expected.parent
    expected = Path(os.path.realpath(expected))
    assert roots == [expected]
    assert Path(os.path.realpath(decoy)) not in roots
    assert expected != Path(os.path.realpath(decoy))
    with pytest.raises(ConfigError):
        assert_outside_repo(expected / "joehub.db")
    assert_outside_repo(decoy / "joehub.db")
    monkeypatch.setenv("JOEHUB_DB_PATH", str(expected / "joehub.db"))
    monkeypatch.setenv("JOEHUB_EXPORT_DIR", str(decoy / "exports"))
    monkeypatch.setenv("JOEHUB_KEY_DIR", str(decoy / "keys"))
    with pytest.raises(ConfigError):
        load_settings()
    for name in ("JOEHUB_DB_PATH", "JOEHUB_EXPORT_DIR", "JOEHUB_KEY_DIR", "JOEHUB_AUTH_HASH_FILE"):
        monkeypatch.delenv(name, raising=False)
    settings = load_settings()
    assert settings.db_path == DEFAULT_DB_PATH
    assert settings.export_dir == DEFAULT_EXPORT_DIR
    assert settings.key_dir == DEFAULT_KEY_DIR
    for path in (settings.db_path, settings.export_dir, settings.key_dir):
        assert not Path(os.path.realpath(path)).is_relative_to(expected)


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
