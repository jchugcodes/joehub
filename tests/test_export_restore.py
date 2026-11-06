from __future__ import annotations

import logging
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest

from joehub.backup import (
    export_all,
    github_slug,
    load_or_create_identity,
    query_github_visibility,
    restore_all,
)
from joehub.db import connect, connect_writer, list_tables, table_columns
from joehub.errors import JoehubError, PrivacyError
from joehub.util import quote_ident
from tests.scripts_seed import seed_main


def _snapshot(db_path: Path) -> dict[str, list[tuple]]:
    conn = connect(db_path)
    try:
        data = {}
        for table in list_tables(conn):
            columns = [row["name"] for row in table_columns(conn, table)]
            quoted = ", ".join(quote_ident(column) for column in columns)
            rows = conn.execute(
                f"SELECT {quoted} FROM {quote_ident(table)} ORDER BY {quote_ident('id')}"
            ).fetchall()
            data[table] = [tuple(row) for row in rows]
        return data
    finally:
        conn.close()


def _secret_line(path: Path) -> str:
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("AGE-SECRET-KEY-"):
            return line
    raise AssertionError("identity file has no secret line")


def test_export_round_trip_preserves_types_constraints_and_ids(settings, caplog, capsys):
    caplog.set_level(logging.INFO)
    seed_main()
    summary = export_all(settings)
    secret = _secret_line(settings.age_identity_path)
    assert (settings.age_identity_path.stat().st_mode & 0o777) == 0o600
    assert secret not in caplog.text
    captured = capsys.readouterr()
    assert "AGE-SECRET-KEY" not in captured.out
    assert "AGE-SECRET-KEY" not in captured.err
    names = sorted(path.name for path in settings.export_dir.glob("*.csv.age"))
    assert names
    assert all(name.endswith(".csv.age") for name in names)
    for path in settings.export_dir.glob("*.csv.age"):
        blob = path.read_bytes()
        assert not blob.startswith(b"id,")
        assert secret.encode() not in blob
    conn = connect(settings.db_path)
    try:
        history = conn.execute("SELECT status FROM export_history").fetchall()
        assert any(row["status"] == "succeeded" for row in history)
        exported = conn.execute(
            "SELECT COUNT(*) FROM export_history WHERE status = 'succeeded'"
        ).fetchone()[0]
        assert exported == 1
    finally:
        conn.close()

    before = _snapshot(settings.db_path)
    restored_path = settings.db_path.parent / "restored.db"
    restore_all(replace(settings, db_path=restored_path))
    after = _snapshot(restored_path)
    assert after.keys() == before.keys()
    for table, rows in before.items():
        assert after[table] == rows, table

    conn = connect_writer(restored_path)
    try:
        amount = conn.execute("SELECT amount_cents FROM transactions ORDER BY date LIMIT 1").fetchone()
        assert isinstance(amount["amount_cents"], int)
        linked = conn.execute(
            """
            SELECT applications.id, companies.id
            FROM applications JOIN companies ON companies.id = applications.company_id
            """
        ).fetchall()
        assert linked
        with pytest.raises(Exception):
            conn.execute(
                """
                INSERT INTO applications (
                    id, notion_id, migrated_on, last_modified_by, last_modified_at, role_title, status
                ) VALUES ('018f0000-0000-7000-8000-000000000301', NULL, NULL, 'Scout',
                          '2026-04-01T00:00:00Z', 'Role', 'Nope')
                """
            )
        with pytest.raises(Exception):
            conn.execute(
                """
                INSERT INTO transactions (
                    id, notion_id, migrated_on, last_modified_by, last_modified_at,
                    account_id, amount_cents, date
                ) VALUES ('018f0000-0000-7000-8000-000000000302', NULL, NULL, 'Ledger',
                          '2026-04-01T00:00:00Z', '018f0000-0000-7000-8000-000000000399', 1, '2026-04-01')
                """
            )
    finally:
        conn.close()

    again = export_all(settings)
    assert sorted(path.name for path in settings.export_dir.glob("*.csv.age")) == sorted(again.files)


def test_restore_refuses_to_clobber_without_force(settings):
    export_all(settings)
    with pytest.raises(JoehubError, match="already exists"):
        restore_all(settings, force=False)


def test_visibility_check_requires_private_github(tmp_path):
    calls = []

    def runner(cmd, **_kwargs):
        calls.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, stdout='{"visibility":"PRIVATE"}', stderr="")

    assert query_github_visibility("git@github.com:example/joehub.git", runner=runner) == "PRIVATE"
    assert calls[0][0:3] == ["gh", "repo", "view"]
    assert "--json" in calls[0]
    assert "visibility" in calls[0]
    assert "example/joehub" in calls[0]

    def public(cmd, **_kwargs):
        return subprocess.CompletedProcess(cmd, 0, stdout='{"visibility":"PUBLIC"}', stderr="")

    with pytest.raises(PrivacyError, match="PRIVATE"):
        query_github_visibility("https://github.com/example/joehub", runner=public)

    def broken(cmd, **_kwargs):
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="nope")

    with pytest.raises(PrivacyError, match="failed"):
        query_github_visibility("ssh://git@github.com/example/joehub.git", runner=broken)

    used = []

    def unused(cmd, **_kwargs):
        used.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, stdout="{}", stderr="")

    with pytest.raises(PrivacyError):
        query_github_visibility(str(tmp_path / "local.git"), runner=unused)
    assert used == []
    assert github_slug("https://github.com/example/joehub.git") == "example/joehub"


def test_push_uses_local_bare_repo_and_refuses_when_check_fails(settings, tmp_path):
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", str(bare)], check=True, capture_output=True)
    with pytest.raises(PrivacyError):
        export_all(settings, remote=str(bare), visibility_check=lambda _remote: "PUBLIC")
    probe = subprocess.run(["git", "--git-dir", str(bare), "rev-parse", "main"], capture_output=True, text=True)
    assert probe.returncode != 0

    summary = export_all(settings, remote=str(bare), visibility_check=lambda _remote: "PRIVATE")
    assert summary.pushed is True
    assert summary.push_status == "pushed"
    clone = tmp_path / "clone"
    subprocess.run(["git", "clone", str(bare), str(clone)], check=True, capture_output=True)
    exported = sorted(path.name for path in clone.glob("*.csv.age"))
    assert "transactions.csv.age" in exported
    assert "export_history.csv.age" in exported
    identity = load_or_create_identity(settings.age_identity_path)
    import pyrage

    history = pyrage.decrypt((clone / "export_history.csv.age").read_bytes(), [identity]).decode()
    assert "pushed" in history
    assert "succeeded" in history
    secret = _secret_line(settings.age_identity_path)
    for path in clone.glob("*.csv.age"):
        assert secret.encode() not in path.read_bytes()
