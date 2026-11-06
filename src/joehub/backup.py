"""Encrypted CSV export, private-repo push, and restore.

Exports are one age-encrypted CSV per table, taken from a single read snapshot
and published as one generation. The identity file lives in the key directory
(outside the repo). It is created with mode 600 when missing and is never logged.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import pyrage
from pyrage import x25519

from joehub.config import Settings, load_settings
from joehub.db import connect, connect_writer, list_tables, migrate, table_columns
from joehub.errors import ConfigError, JoehubError, PrivacyError
from joehub.principals import ensure_principals, token_for
from joehub.util import quote_ident, utcnow
from joehub.write import WriteLayer

log = logging.getLogger("joehub.backup")

VisibilityCheck = Callable[[str], str]

_GITHUB_REMOTE = re.compile(
    r"^(?:git@github\.com:|ssh://git@github\.com/|https://github\.com/)"
    r"(?P<slug>[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?$"
)
_ARTIFACT_NAME = re.compile(r"^[a-z][a-z0-9_]*\.csv\.age$")
_NULL_TOKEN = r"\N"


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


def encode_cell(value: object) -> str:
    """Encode one value so NULL, empty text, and the literal NULL token stay distinct."""
    if value is None:
        return _NULL_TOKEN
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        text = str(value)
    elif isinstance(value, int):
        text = str(value)
    else:
        text = value
    return text.replace("\\", "\\\\")


def decode_cell(raw: str, sql_type: str) -> object:
    if raw == _NULL_TOKEN:
        return None
    text = raw.replace("\\\\", "\\")
    if (sql_type or "").upper().startswith("INT"):
        try:
            return int(text)
        except ValueError as exc:
            raise JoehubError("exported integer is not an integer") from exc
    return text


def dump_table_csv(conn: sqlite3.Connection, table: str) -> bytes:
    columns = [row["name"] for row in table_columns(conn, table)]
    quoted_cols = ", ".join(quote_ident(column) for column in columns)
    sql = f"SELECT {quoted_cols} FROM {quote_ident(table)} ORDER BY {quote_ident('id')}"
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(columns)
    for row in conn.execute(sql):
        writer.writerow([encode_cell(value) for value in row])
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
        values = [decode_cell(raw, types[column]) for column, raw in zip(columns, line)]
        parsed.append(tuple(values))
    return parsed


def read_consistent_snapshot(db_path: Path) -> dict[str, bytes]:
    """Read every table inside one deferred transaction so writers cannot tear the set."""
    conn = connect(db_path)
    try:
        conn.execute("BEGIN")
        try:
            return {table: dump_table_csv(conn, table) for table in list_tables(conn)}
        finally:
            conn.rollback()
    finally:
        conn.close()


def publish_snapshot(export_dir: Path, payloads: dict[str, bytes]) -> list[str]:
    """Stage a full generation, swing ``current`` atomically, then refresh stable names.

    ``current`` is the consistent set. Stable ``*.csv.age`` names are updated
    only after that swing and only while the publish lock is held. A crash
    before the swing leaves the previous generation in place.
    """
    export_dir.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(export_dir, 0o700)
    lock_path = export_dir / ".publish.lock"
    names = sorted(payloads)
    for name in names:
        if _ARTIFACT_NAME.fullmatch(name) is None:
            raise JoehubError(f"refusing to publish {name}")
    with lock_path.open("a", encoding="utf-8") as handle:
        import fcntl

        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        staging = export_dir / f".staging-{uuid.uuid4().hex}"
        try:
            staging.mkdir()
            for name in names:
                (staging / name).write_bytes(payloads[name])
            generation_id = uuid.uuid4().hex
            generations = export_dir / "generations"
            generations.mkdir(exist_ok=True)
            final = generations / generation_id
            os.rename(staging, final)
            link_tmp = export_dir / f".current-{generation_id}"
            link_tmp.symlink_to(Path("generations") / generation_id)
            os.replace(link_tmp, export_dir / "current")
            for name in names:
                temporary = export_dir / f".{name}.{generation_id}"
                shutil.copyfile(final / name, temporary)
                os.replace(temporary, export_dir / name)
            return names
        except Exception:
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)
            raise
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def published_dir(export_dir: Path) -> Path:
    current = export_dir / "current"
    if current.is_symlink():
        raw = Path(os.readlink(current))
        target = raw if raw.is_absolute() else export_dir / raw
        if target.is_dir():
            return target
    return export_dir


def _encrypted_snapshot(settings: Settings, recipient) -> dict[str, bytes]:
    plain = read_consistent_snapshot(settings.db_path)
    return {
        export_filename(table): pyrage.encrypt(payload, [recipient])
        for table, payload in plain.items()
    }


def export_all(
    settings: Settings | None = None,
    *,
    remote: str | None = None,
    visibility_check: VisibilityCheck | None = None,
) -> ExportSummary:
    settings = settings or load_settings()
    migrate(settings.db_path)
    ensure_principals(settings)
    settings.export_dir.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(settings.export_dir, 0o700)
    identity = load_or_create_identity(settings.age_identity_path)
    recipient = identity.to_public()
    writer = WriteLayer(settings)
    cato = token_for(settings, "Cato")
    started = utcnow()
    target_remote = remote if remote is not None else settings.export_remote
    log.info("export started")
    created = writer.write(
        credential=cato,
        table="export_history",
        operation="insert",
        idempotency_key=f"export:{uuid.uuid4()}",
        payload={
            "started_at": started,
            "status": "running",
            "export_dir": str(settings.export_dir),
            "remote": target_remote,
            "publication_state": "not_requested",
        },
    )
    export_id = created.row_id
    if export_id is None:
        raise JoehubError("export history row was not created")

    def mark(**kwargs: object) -> None:
        _mark_history(writer, cato, export_id, **kwargs)

    try:
        payloads = _encrypted_snapshot(settings, recipient)
        names = publish_snapshot(settings.export_dir, payloads)
    except Exception as exc:
        _mark_failure(writer, cato, export_id, exc)
        raise

    if not target_remote:
        mark(
            status="succeeded",
            finished_at=utcnow(),
            publication_state="not_requested",
            detail="encrypted table export",
        )
        try:
            names = publish_snapshot(settings.export_dir, _encrypted_snapshot(settings, recipient))
        except Exception as exc:
            _mark_failure(writer, cato, export_id, exc)
            raise
        log.info("export finished tables=%s pushed=%s", len(names), False)
        return ExportSummary(export_id=export_id, files=tuple(names), pushed=False, push_status=None)

    check = visibility_check or query_github_visibility
    try:
        visibility = check(target_remote)
        if visibility != "PRIVATE":
            raise PrivacyError(f"refusing push: visibility is {visibility!r}, PRIVATE required")
    except PrivacyError as exc:
        mark(
            status="succeeded",
            finished_at=utcnow(),
            push_status="refused",
            publication_state="refused",
            detail=str(exc)[:500],
        )
        try:
            publish_snapshot(settings.export_dir, _encrypted_snapshot(settings, recipient))
        except Exception as pub_exc:
            _mark_failure(writer, cato, export_id, pub_exc)
            raise pub_exc
        raise

    mark(
        status="succeeded",
        finished_at=utcnow(),
        publication_state="incomplete",
        detail="local export finished; publication is not complete",
    )
    try:
        payloads = _encrypted_snapshot(settings, recipient)
        names = publish_snapshot(settings.export_dir, payloads)
        git_push(settings.export_dir, target_remote, list(payloads))
    except Exception as exc:
        mark(
            push_status="failed",
            publication_state="failed",
            detail=_scrub(str(exc))[:500],
        )
        try:
            publish_snapshot(settings.export_dir, _encrypted_snapshot(settings, recipient))
        except Exception:
            _mark_failure(writer, cato, export_id, exc)
        raise JoehubError("export push failed") from exc

    # The remote now has publication_state=incomplete. A second push carries the
    # final audit. If it fails, the recorded state stays incomplete.
    mark(push_status="pushed", publication_state="pushed", detail="pushed encrypted exports")
    try:
        payloads = _encrypted_snapshot(settings, recipient)
        names = publish_snapshot(settings.export_dir, payloads)
        git_push(settings.export_dir, target_remote, list(payloads))
    except Exception as exc:
        mark(
            push_status="failed",
            publication_state="incomplete",
            detail=f"audit push incomplete: {_scrub(str(exc))[:400]}",
        )
        try:
            names = publish_snapshot(settings.export_dir, _encrypted_snapshot(settings, recipient))
        except Exception:
            names = sorted(payloads)
        raise JoehubError("export publication incomplete") from exc

    log.info("export finished tables=%s pushed=%s", len(names), True)
    return ExportSummary(export_id=export_id, files=tuple(names), pushed=True, push_status="pushed")


def _mark_failure(writer: WriteLayer, credential: str, export_id: str, exc: Exception) -> None:
    try:
        _mark_history(
            writer,
            credential,
            export_id,
            status="failed",
            finished_at=utcnow(),
            publication_state="failed",
            detail=_scrub(str(exc))[:500] or exc.__class__.__name__,
        )
    except Exception:
        log.warning("could not record export failure")


def _mark_history(
    writer: WriteLayer,
    credential: str,
    export_id: str,
    **fields: object,
) -> None:
    payload: dict = {"id": export_id}
    for key, value in fields.items():
        if value is not None:
            payload[key] = value
    writer.write(
        credential=credential,
        table="export_history",
        operation="update",
        idempotency_key=f"export-update:{export_id}:{uuid.uuid4()}",
        payload=payload,
    )


def git_push(export_dir: Path, remote: str, artifacts: list[str]) -> None:
    """Publish allowlisted ciphertext by cloning the remote. Never force-pushes."""
    source = published_dir(export_dir)
    names: list[str] = []
    for name in artifacts:
        if _ARTIFACT_NAME.fullmatch(name) is None:
            raise JoehubError(f"refusing to publish {name}")
        if not (source / name).is_file():
            raise JoehubError(f"missing artifact {name}")
        names.append(name)
    work = Path(tempfile.mkdtemp(prefix="joehub-publish-"))
    try:
        if not _clone_main(remote, work):
            if work.exists():
                shutil.rmtree(work)
            work.mkdir()
            _git_init(work)
            _git(work, "remote", "add", "origin", remote)
        else:
            _ensure_identity(work)
        for name in names:
            shutil.copyfile(source / name, work / name)
        _git(work, "add", "--", *names)
        status = _git(work, "status", "--porcelain")
        if status.stdout.strip():
            _git(work, "commit", "-m", "Update joehub encrypted exports")
        _push_fast_forward(work)
        _point_local_bare_head(remote)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _clone_main(remote: str, work: Path) -> bool:
    completed = subprocess.run(
        ["git", "clone", "--branch", "main", remote, str(work)],
        capture_output=True,
        text=True,
    )
    return completed.returncode == 0


def _git_init(work: Path) -> None:
    subprocess.run(
        ["git", "init", "-b", "main", str(work)],
        check=True,
        capture_output=True,
        text=True,
    )
    _ensure_identity(work)


def _ensure_identity(work: Path) -> None:
    env = _git_env()
    _git(work, "config", "user.email", "joehub-export@example.com", env=env)
    _git(work, "config", "user.name", "joehub-export", env=env)


def _push_fast_forward(work: Path) -> None:
    try:
        _git(work, "push", "-u", "origin", "HEAD:main")
    except JoehubError:
        _git(work, "fetch", "origin")
        _git(work, "rebase", "origin/main")
        _git(work, "push", "-u", "origin", "HEAD:main")


def _point_local_bare_head(remote: str) -> None:
    remote_path = Path(remote)
    head = remote_path / "HEAD"
    if not head.is_file():
        return
    subprocess.run(
        ["git", "--git-dir", str(remote_path), "symbolic-ref", "HEAD", "refs/heads/main"],
        check=True,
        capture_output=True,
        text=True,
        env=_git_env(),
    )


def _git_env() -> dict[str, str]:
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    return env


def _git(work: Path, *args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    if any(arg == "--force" or arg == "--force-with-lease" or arg.startswith("+") for arg in args):
        raise JoehubError("refusing force-push")
    try:
        return subprocess.run(
            ["git", "-C", str(work), *args],
            check=True,
            capture_output=True,
            text=True,
            env=env or _git_env(),
        )
    except subprocess.CalledProcessError as exc:
        raise JoehubError(_scrub(exc.stderr or "git command failed")) from None


def _scrub(text: str) -> str:
    if "AGE-SECRET-KEY" in text:
        return "command failed"
    return text.strip()


def restore_all(settings: Settings | None = None, *, force: bool = False) -> None:
    """Decrypt and validate into a temporary database, then replace the live file.

    The existing database, including its WAL, is left untouched until integrity,
    foreign keys, row counts, and the id column all check out. The caller must
    stop other joehub processes first; restore refuses when it cannot take an
    exclusive lock.
    """
    settings = settings or load_settings()
    db_path = settings.db_path
    if db_path.exists() and not force:
        raise JoehubError(f"{db_path} already exists; pass force to rebuild it")
    source = published_dir(settings.export_dir)
    identity = load_or_create_identity(settings.age_identity_path)
    tmp = db_path.with_name(db_path.name + f".restore-{uuid.uuid4().hex}")
    try:
        migrate(tmp)
        conn = connect_writer(tmp)
        try:
            tables = list_tables(conn)
            decrypted: dict[str, bytes] = {}
            for table in tables:
                path = source / export_filename(table)
                if not path.is_file():
                    raise JoehubError(f"missing encrypted export for {table}")
                try:
                    decrypted[table] = pyrage.decrypt(path.read_bytes(), [identity])
                except Exception as exc:
                    raise JoehubError(f"could not decrypt {table}") from exc
            parsed: dict[str, list[tuple]] = {}
            conn.execute("PRAGMA foreign_keys = OFF")
            conn.execute("BEGIN IMMEDIATE")
            try:
                for table in tables:
                    conn.execute(f"DELETE FROM {quote_ident(table)}")
                    rows = parse_table_csv(conn, table, decrypted[table])
                    parsed[table] = rows
                    if not rows:
                        continue
                    columns = [row["name"] for row in table_columns(conn, table)]
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
            _validate_restored(conn, tables, parsed)
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            conn.close()
        for suffix in ("-wal", "-shm"):
            sidecar = Path(str(tmp) + suffix)
            if sidecar.exists():
                sidecar.unlink()
        if db_path.exists():
            _require_runtime_stopped(db_path)
        os.replace(tmp, db_path)
    except Exception:
        _discard_database(tmp)
        raise
    log.info("restore finished")


def _validate_restored(
    conn: sqlite3.Connection,
    tables: list[str],
    parsed: dict[str, list[tuple]],
) -> None:
    integrity = conn.execute("PRAGMA integrity_check").fetchone()
    if integrity is None or integrity[0] != "ok":
        raise JoehubError("restored database failed integrity_check")
    conn.execute("PRAGMA foreign_keys = ON")
    broken = conn.execute("PRAGMA foreign_key_check").fetchall()
    if broken:
        raise JoehubError("restored database failed foreign key checks")
    for table in tables:
        count = conn.execute(f"SELECT COUNT(*) FROM {quote_ident(table)}").fetchone()[0]
        if count != len(parsed[table]):
            raise JoehubError(f"{table} row count does not match the export")
        columns = [row["name"] for row in table_columns(conn, table)]
        if not columns or columns[0] != "id":
            raise JoehubError(f"{table} schema is missing the id column")


def _require_runtime_stopped(db_path: Path) -> None:
    conn = connect_writer(db_path)
    try:
        conn.execute("BEGIN EXCLUSIVE")
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.commit()
    except sqlite3.OperationalError as exc:
        _rollback_quiet(conn)
        raise JoehubError("refusing restore: the runtime still has the database open") from exc
    finally:
        conn.close()
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(db_path) + suffix)
        if sidecar.exists():
            sidecar.unlink()


def _discard_database(db_path: Path) -> None:
    for suffix in ("", "-wal", "-shm"):
        sidecar = Path(str(db_path) + suffix)
        if sidecar.exists():
            sidecar.unlink()


def _rollback_quiet(conn: sqlite3.Connection) -> None:
    try:
        conn.rollback()
    except sqlite3.Error:
        pass
