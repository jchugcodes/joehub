"""Encrypted CSV export, private-repo push, and restore.

Exports are one age-encrypted CSV per table. The identity file lives in the key
directory (outside the repo). It is created with mode 600 when missing and is never logged.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
import sqlite3
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import pyrage
from pyrage import x25519

from joehub.config import Settings, load_settings
from joehub.db import connect, list_tables, migrate, table_columns
from joehub.errors import ConfigError, JoehubError, PrivacyError
from joehub.util import quote_ident, utcnow
from joehub.write import WriteLayer

log = logging.getLogger("joehub.backup")

VisibilityCheck = Callable[[str], str]

_GITHUB_REMOTE = re.compile(
    r"^(?:git@github\.com:|ssh://git@github\.com/|https://github\.com/)"
    r"(?P<slug>[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?$"
)


@dataclass(frozen=True)
class ExportSummary:
    export_id: str
    files: tuple[str, ...]
    pushed: bool
    push_status: str | None


def github_slug(remote: str) -> str | None:
    match = _GITHUB_REMOTE.match(remote.strip())
    if match is None:
        return None
    return match.group("slug")


def query_github_visibility(remote: str, runner=None) -> str:
    """Refuse unless `gh repo view --json visibility` reports PRIVATE."""
    slug = github_slug(remote)
    if slug is None:
        raise PrivacyError("refusing push: remote is not a GitHub repository we can check")
    command = ["gh", "repo", "view", slug, "--json", "visibility"]
    run = runner or subprocess.run
    completed = run(command, capture_output=True, text=True)
    if getattr(completed, "returncode", 1) != 0:
        raise PrivacyError("refusing push: gh visibility check failed")
    try:
        payload = json.loads(completed.stdout or "")
    except json.JSONDecodeError as exc:
        raise PrivacyError("refusing push: unreadable visibility response") from exc
    visibility = payload.get("visibility")
    if visibility != "PRIVATE":
        raise PrivacyError(f"refusing push: visibility is {visibility!r}, PRIVATE required")
    return str(visibility)


def load_or_create_identity(path: Path) -> x25519.Identity:
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(path.parent, 0o700)
    if not path.exists():
        identity = x25519.Identity.generate()
        public = str(identity.to_public())
        secret = str(identity)
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            return _read_identity(path)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write("# joehub age identity\n")
            handle.write(f"# public key: {public}\n")
            handle.write(secret + "\n")
        os.chmod(path, 0o600)
        return identity
    return _read_identity(path)


def _read_identity(path: Path) -> x25519.Identity:
    os.chmod(path, 0o600)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigError("age identity file is unreadable") from exc
    secret = None
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("AGE-SECRET-KEY-"):
            secret = stripped
            break
    if secret is None:
        raise ConfigError("age identity file is unreadable")
    try:
        return x25519.Identity.from_str(secret)
    except Exception as exc:
        raise ConfigError("age identity file is unreadable") from exc


def export_filename(table: str) -> str:
    return f"{table}.csv.age"


def dump_table_csv(conn: sqlite3.Connection, table: str) -> bytes:
    columns = [row["name"] for row in table_columns(conn, table)]
    quoted_cols = ", ".join(quote_ident(column) for column in columns)
    sql = f"SELECT {quoted_cols} FROM {quote_ident(table)} ORDER BY {quote_ident('id')}"
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(columns)
    for row in conn.execute(sql):
        writer.writerow(["" if value is None else value for value in row])
    return buffer.getvalue().encode("utf-8")


def parse_table_csv(conn: sqlite3.Connection, table: str, payload: bytes) -> list[tuple]:
    columns = [row["name"] for row in table_columns(conn, table)]
    types = {row["name"]: (row["type"] or "").upper() for row in table_columns(conn, table)}
    text = payload.decode("utf-8")
    reader = csv.reader(io.StringIO(text, newline=""))
    try:
        header = next(reader)
    except StopIteration as exc:
        raise JoehubError(f"{table} export is empty") from exc
    if header != columns:
        raise JoehubError(f"{table} export columns do not match the schema")
    parsed: list[tuple] = []
    for line in reader:
        if len(line) != len(columns):
            raise JoehubError(f"{table} export has a row with the wrong width")
        values = []
        for column, raw in zip(columns, line):
            if raw == "":
                values.append(None)
            elif types[column].startswith("INT"):
                try:
                    values.append(int(raw))
                except ValueError as exc:
                    raise JoehubError(f"{table}.{column} is not an integer") from exc
            else:
                values.append(raw)
        parsed.append(tuple(values))
    return parsed


def _encrypt_table(conn: sqlite3.Connection, table: str, export_dir: Path, recipient) -> str:
    plaintext = dump_table_csv(conn, table)
    blob = pyrage.encrypt(plaintext, [recipient])
    filename = export_filename(table)
    (export_dir / filename).write_bytes(blob)
    return filename


def _dump_all(settings: Settings, recipient) -> list[str]:
    conn = connect(settings.db_path)
    try:
        return [
            _encrypt_table(conn, table, settings.export_dir, recipient) for table in list_tables(conn)
        ]
    finally:
        conn.close()


def export_all(
    settings: Settings | None = None,
    *,
    remote: str | None = None,
    visibility_check: VisibilityCheck | None = None,
) -> ExportSummary:
    settings = settings or load_settings()
    migrate(settings.db_path)
    settings.export_dir.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(settings.export_dir, 0o700)
    identity = load_or_create_identity(settings.age_identity_path)
    recipient = identity.to_public()
    writer = WriteLayer(settings)
    started = utcnow()
    target_remote = remote if remote is not None else settings.export_remote
    log.info("export started")
    created = writer.write(
        owner="Cato",
        table="export_history",
        operation="insert",
        idempotency_key=f"export:{uuid.uuid4()}",
        payload={
            "started_at": started,
            "status": "running",
            "export_dir": str(settings.export_dir),
            "remote": target_remote,
        },
    )
    export_id = created.row_id
    if export_id is None:
        raise JoehubError("export history row was not created")

    push_status: str | None = None
    pushed = False
    try:
        _mark_history(
            writer,
            export_id,
            status="succeeded",
            finished_at=utcnow(),
            detail="encrypted table export",
        )
        files = _dump_all(settings, recipient)
        if target_remote:
            check = visibility_check or query_github_visibility
            try:
                visibility = check(target_remote)
                if visibility != "PRIVATE":
                    raise PrivacyError(
                        f"refusing push: visibility is {visibility!r}, PRIVATE required"
                    )
            except PrivacyError as exc:
                push_status = "refused"
                _mark_history(writer, export_id, push_status=push_status, detail=str(exc)[:500])
                files = _dump_all(settings, recipient)
                raise
            try:
                git_push(settings.export_dir, target_remote)
                push_status = "pushed"
                pushed = True
                _mark_history(
                    writer,
                    export_id,
                    push_status=push_status,
                    detail="pushed encrypted exports",
                )
                files = _dump_all(settings, recipient)
                git_push(settings.export_dir, target_remote)
            except Exception as exc:
                push_status = "failed"
                pushed = False
                _mark_history(writer, export_id, push_status=push_status, detail=_scrub(str(exc))[:500])
                files = _dump_all(settings, recipient)
                raise JoehubError("export push failed") from exc
    except PrivacyError:
        raise
    except JoehubError:
        raise
    except Exception as exc:
        _mark_history(writer, export_id, status="failed", detail=str(exc)[:500])
        try:
            _dump_all(settings, recipient)
        except Exception:
            pass
        raise

    log.info("export finished tables=%s pushed=%s", len(files), pushed)
    return ExportSummary(export_id=export_id, files=tuple(files), pushed=pushed, push_status=push_status)


def _mark_history(
    writer: WriteLayer,
    export_id: str,
    *,
    status: str | None = None,
    finished_at: str | None = None,
    push_status: str | None = None,
    detail: str | None = None,
) -> None:
    payload: dict = {"id": export_id}
    if status is not None:
        payload["status"] = status
    if finished_at is not None:
        payload["finished_at"] = finished_at
    if push_status is not None:
        payload["push_status"] = push_status
    if detail is not None:
        payload["detail"] = detail
    writer.write(
        owner="Cato",
        table="export_history",
        operation="update",
        idempotency_key=f"export-update:{export_id}:{uuid.uuid4()}",
        payload=payload,
    )


def git_push(export_dir: Path, remote: str) -> None:
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    if not (export_dir / ".git").exists():
        subprocess.run(
            ["git", "init", "-b", "main", str(export_dir)],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
        _git(export_dir, "config", "user.email", "joehub-export@example.com", env=env)
        _git(export_dir, "config", "user.name", "joehub-export", env=env)
    (export_dir / ".gitignore").write_text(
        "age-identity.txt\n*.key\ndashboard_auth_hash\n",
        encoding="utf-8",
    )
    _git(export_dir, "add", "-A", env=env)
    status = _git(export_dir, "status", "--porcelain", env=env)
    if status.stdout.strip():
        _git(export_dir, "commit", "-m", "Update joehub encrypted exports", env=env)
    remotes = _git(export_dir, "remote", env=env).stdout.split()
    if "origin" in remotes:
        _git(export_dir, "remote", "set-url", "origin", remote, env=env)
    else:
        _git(export_dir, "remote", "add", "origin", remote, env=env)
    _git(export_dir, "push", "-u", "origin", "HEAD:main", env=env)
    # Local bare repos keep their initial HEAD (often master). Point it at the branch we publish
    # so a later clone checks out the encrypted files.
    remote_path = Path(remote)
    head = remote_path / "HEAD"
    if head.is_file():
        subprocess.run(
            ["git", "--git-dir", str(remote_path), "symbolic-ref", "HEAD", "refs/heads/main"],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )


def _git(export_dir: Path, *args: str, env: dict) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            ["git", "-C", str(export_dir), *args],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
    except subprocess.CalledProcessError as exc:
        raise JoehubError(_scrub(exc.stderr or "git command failed")) from None


def _scrub(text: str) -> str:
    if "AGE-SECRET-KEY" in text:
        return "command failed"
    return text.strip()


def restore_all(settings: Settings | None = None, *, force: bool = False) -> None:
    settings = settings or load_settings()
    db_path = settings.db_path
    if db_path.exists() and not force:
        raise JoehubError(f"{db_path} already exists; pass force to rebuild it")
    if db_path.exists() and force:
        db_path.unlink()
        for suffix in ("-wal", "-shm"):
            sidecar = Path(str(db_path) + suffix)
            if sidecar.exists():
                sidecar.unlink()
    migrate(db_path)
    identity = load_or_create_identity(settings.age_identity_path)
    conn = connect(db_path)
    try:
        tables = list_tables(conn)
        decrypted: dict[str, bytes] = {}
        for table in tables:
            path = settings.export_dir / export_filename(table)
            if not path.is_file():
                raise JoehubError(f"missing encrypted export for {table}")
            try:
                decrypted[table] = pyrage.decrypt(path.read_bytes(), [identity])
            except Exception as exc:
                raise JoehubError(f"could not decrypt {table}") from exc
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("BEGIN IMMEDIATE")
        try:
            for table in tables:
                conn.execute(f"DELETE FROM {quote_ident(table)}")
            for table in tables:
                rows = parse_table_csv(conn, table, decrypted[table])
                columns = [row["name"] for row in table_columns(conn, table)]
                if not rows:
                    continue
                collist = ", ".join(quote_ident(column) for column in columns)
                placeholders = ", ".join("?" for _ in columns)
                conn.executemany(
                    f"INSERT INTO {quote_ident(table)} ({collist}) VALUES ({placeholders})",
                    rows,
                )
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except sqlite3.Error:
                pass
            raise
        conn.execute("PRAGMA foreign_keys = ON")
        broken = conn.execute("PRAGMA foreign_key_check").fetchall()
        if broken:
            raise JoehubError("restored database failed foreign key checks")
    finally:
        conn.close()
    log.info("restore finished")
