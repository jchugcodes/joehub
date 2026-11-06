"""Durable restore handover.

The exclusive SQLite lock is held on the old inode. ``os.replace`` publishes a
new inode that lock does not cover, and the rotated operator credential is a
second file. A crash or a competing opener in that gap must not observe a
database whose hashes do not match the token on disk, and must not destroy the
only copy of the previous database before the new pair is valid.

The gate file is honored by every opener in ``joehub.db``. The restoring
process holds an flock on the gate for the whole gap. When that process dies
the kernel drops the flock, and the next opener finishes or rolls back the
journal instead of using the database.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Callable

from joehub.config import Settings
from joehub.db import (
    _maintenance_connect,
    maintenance_gate_path,
    maintenance_lock_path,
)
from joehub.errors import JoehubError
from joehub.principals import (
    HUMAN_NAME,
    operator_token_path,
    token_digest,
    write_token_file,
)

_in_recover = threading.local()


def handover_journal_path(db_path: Path) -> Path:
    return Path(str(db_path) + ".handover.json")


def original_copy_path(db_path: Path) -> Path:
    return Path(str(db_path) + ".original")


def commit_restored_database(
    settings: Settings,
    incoming: Path,
    minted: str | None,
    *,
    interrupt: Callable[[], None] | None = None,
) -> None:
    """Publish ``incoming`` and its operator credential as one handover.

    ``interrupt`` runs after the new database is on the live path and before
    the credential is installed. The original copy and the gate are still in
    place. Tests use it to simulate a crash; production passes none.
    """
    live = settings.db_path
    recover_restore_handover(live)
    if maintenance_gate_path(live).exists():
        raise JoehubError("database is in a restore handover; refusing to open")

    staged_secret = _stage_credential(settings, minted)
    had_live = live.is_file()
    original_sha = _sha256(live) if had_live else ""
    incoming_sha = _sha256(incoming)
    nonce = uuid.uuid4().hex + uuid.uuid4().hex
    token_path = operator_token_path(settings)
    journal_path = handover_journal_path(live)
    original = original_copy_path(live)
    journal = {
        "version": 1,
        "phase": "prepared",
        "live_db": str(live),
        "incoming_db": str(incoming),
        "original_db": str(original),
        "original_sha256": original_sha,
        "incoming_sha256": incoming_sha,
        "staged_token_path": str(token_path.with_name("operator.token.staged")),
        "previous_token_path": str(token_path.with_name("operator.token.previous")),
        "operator_token_path": str(token_path),
        "nonce": nonce,
        "had_live_db": had_live,
        "staged_digest": token_digest(staged_secret),
    }
    gate: _Gate | None = None
    holder: sqlite3.Connection | None = None
    replaced = False
    verified = False
    try:
        gate = _Gate.lock(live)
        _write_json(journal_path, journal)
        gate.publish(nonce)
        _update(journal_path, journal, phase="gated")
        if had_live:
            holder = _hold_exclusive(live, nonce)
            original_sha = _sha256(live)
            journal["original_sha256"] = original_sha
            _update(journal_path, journal, phase="gated")
            _copy_fsync(live, original)
            if _sha256(original) != original_sha:
                raise JoehubError("could not preserve the original database")
            for suffix in ("-wal", "-shm"):
                sidecar = Path(str(live) + suffix)
                if sidecar.exists():
                    sidecar.unlink()
        os.replace(incoming, live)
        replaced = True
        _fsync_dir(live.parent)
        _update(journal_path, journal, phase="db_installed")
        if interrupt is not None:
            interrupt()
        _install_staged_token(journal)
        _update(journal_path, journal, phase="token_installed")
        if not _token_matches(journal):
            raise JoehubError("restored database does not match the operator credential")
        _discard_recovered_original(journal)
        _unlink_quiet(journal_path)
        if gate is not None:
            gate.clear()
            gate = None
        verified = True
    except BaseException:
        if not replaced:
            _abort_files(journal)
            if gate is not None:
                gate.clear()
                gate = None
            _unlink_quiet(journal_path)
        raise
    finally:
        if holder is not None:
            holder.close()
        if gate is not None and not verified:
            gate.release_lock_only()


def recover_restore_handover(db_path: Path) -> bool:
    """Finish or roll back a handover whose owner has died.

    Returns True when a journal was completed or discarded. Returns False when
    there is nothing to do, or another live owner still holds the gate.
    """
    if getattr(_in_recover, "on", False):
        return False
    journal_path = handover_journal_path(db_path)
    gate_path = maintenance_gate_path(db_path)
    if not journal_path.is_file() and not gate_path.is_file():
        return False
    lock_path = maintenance_lock_path(db_path)
    lock_path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        try:
            import fcntl

            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        _in_recover.on = True
        try:
            if not journal_path.is_file():
                raise JoehubError("restore gate has no handover journal; refusing to open")
            journal = _read_json(journal_path)
            _require_journal(journal, db_path)
            live = Path(str(journal["live_db"]))
            live_sha = _sha256(live) if live.is_file() else ""
            if live_sha and live_sha == journal["incoming_sha256"]:
                _complete_installed(journal, journal_path)
                return True
            if journal.get("had_live_db") and live_sha == journal["original_sha256"]:
                _abort_files(journal)
                _unlink_quiet(journal_path)
                _unlink_quiet(gate_path)
                return True
            if not journal.get("had_live_db") and not live_sha:
                _abort_files(journal)
                _unlink_quiet(journal_path)
                _unlink_quiet(gate_path)
                return True
            raise JoehubError("restore handover is inconsistent; refusing to open")
        finally:
            _in_recover.on = False
            import fcntl

            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def _complete_installed(journal: dict, journal_path: Path) -> None:
    _install_staged_token(journal)
    if not _token_matches(journal):
        if journal.get("had_live_db"):
            _rollback_original(journal)
            _unlink_quiet(journal_path)
            _unlink_quiet(maintenance_gate_path(Path(journal["live_db"])))
            return
        raise JoehubError("restored database does not match the staged operator credential")
    _discard_recovered_original(journal)
    _unlink_quiet(journal_path)
    _unlink_quiet(maintenance_gate_path(Path(journal["live_db"])))


def _install_staged_token(journal: dict) -> None:
    staged = Path(journal["staged_token_path"])
    if not staged.is_file():
        current = Path(journal["operator_token_path"])
        if current.is_file() and token_digest(current.read_text(encoding="utf-8").strip()) == journal["staged_digest"]:
            return
        raise JoehubError("staged operator credential is missing")
    secret = staged.read_text(encoding="utf-8").strip()
    if token_digest(secret) != journal["staged_digest"]:
        raise JoehubError("staged operator credential does not match the handover journal")
    write_token_file(Path(journal["operator_token_path"]), secret)


def _token_matches(journal: dict) -> bool:
    token_path = Path(journal["operator_token_path"])
    if not token_path.is_file():
        return False
    secret = token_path.read_text(encoding="utf-8").strip()
    if token_digest(secret) != journal["staged_digest"]:
        return False
    live = Path(journal["live_db"])
    conn = _maintenance_connect(live, maintenance_token=str(journal["nonce"]))
    try:
        row = conn.execute(
            "SELECT token_sha256 FROM principals WHERE name = ?",
            (HUMAN_NAME,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return False
    stored = str(row["token_sha256"])
    if len(stored) != len(journal["staged_digest"]):
        return False
    import hmac

    return hmac.compare_digest(stored, journal["staged_digest"])


def _rollback_original(journal: dict) -> None:
    live = Path(journal["live_db"])
    original = Path(journal["original_db"])
    if not original.is_file():
        raise JoehubError("original database copy is missing; refusing to roll back blindly")
    rejected = Path(str(live) + ".rejected")
    if live.exists():
        os.replace(live, rejected)
    _copy_fsync(original, live)
    _fsync_dir(live.parent)
    previous = Path(journal["previous_token_path"])
    if previous.is_file():
        write_token_file(Path(journal["operator_token_path"]), previous.read_text(encoding="utf-8").strip())
    if _sha256(live) == journal["original_sha256"]:
        _unlink_quiet(original)


def _discard_recovered_original(journal: dict) -> None:
    """Delete the preserved original only after the live credential pair is valid.

    The caller has already checked that the live file is the incoming database,
    before any connection could rewrite the header. A later open may change
    bytes, so this does not hash the file again.
    """
    live = Path(journal["live_db"])
    if not live.is_file():
        raise JoehubError("refusing to delete the original database before the handover is valid")
    if not _token_matches(journal):
        raise JoehubError("refusing to delete the original database before the handover is valid")
    _unlink_quiet(Path(journal["original_db"]))
    _unlink_quiet(Path(journal["staged_token_path"]))
    _unlink_quiet(Path(journal["previous_token_path"]))
    for suffix in ("-wal", "-shm"):
        _unlink_quiet(Path(str(journal["original_db"]) + suffix))


def _abort_files(journal: dict) -> None:
    live = Path(journal["live_db"])
    original = Path(journal["original_db"])
    live_sha = _sha256(live) if live.is_file() else ""
    if journal.get("had_live_db"):
        if live_sha != journal["original_sha256"]:
            raise JoehubError("restore handover is inconsistent; refusing to open")
        _unlink_quiet(original)
    incoming = Path(journal["incoming_db"])
    if incoming.resolve() != live.resolve():
        _unlink_db(incoming)
    _unlink_quiet(Path(journal["staged_token_path"]))
    _unlink_quiet(Path(journal["previous_token_path"]))


def _stage_credential(settings: Settings, minted: str | None) -> str:
    path = operator_token_path(settings)
    previous = path.with_name("operator.token.previous")
    staged = path.with_name("operator.token.staged")
    if path.is_file():
        write_token_file(previous, path.read_text(encoding="utf-8").strip())
    elif previous.exists():
        previous.unlink()
    if minted is None:
        if not path.is_file():
            raise JoehubError("restore produced no operator credential")
        minted = path.read_text(encoding="utf-8").strip()
    write_token_file(staged, minted)
    return minted


def _hold_exclusive(db_path: Path, nonce: str) -> sqlite3.Connection:
    conn = _maintenance_connect(db_path, maintenance_token=nonce)
    try:
        conn.execute("PRAGMA locking_mode = EXCLUSIVE")
        conn.execute("BEGIN EXCLUSIVE")
        conn.commit()
        row = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
    except sqlite3.OperationalError as exc:
        conn.close()
        raise JoehubError("refusing restore: the runtime still has the database open") from exc
    except Exception:
        conn.close()
        raise
    if row is not None and int(row[0]) != 0:
        conn.close()
        raise JoehubError("refusing restore: the runtime still has the database open")
    return conn


class _Gate:
    def __init__(self, db_path: Path, fd: int):
        self.db_path = db_path
        self.fd = fd

    @classmethod
    def lock(cls, db_path: Path) -> _Gate:
        import fcntl

        lock_path = maintenance_lock_path(db_path)
        lock_path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            os.close(fd)
            raise JoehubError("a restore handover is already in progress") from exc
        return cls(db_path, fd)

    def publish(self, nonce: str) -> None:
        _write_json(maintenance_gate_path(self.db_path), {"nonce": nonce, "purpose": "restore"})
        os.chmod(maintenance_gate_path(self.db_path), 0o600)

    def release_lock_only(self) -> None:
        if self.fd is None:
            return
        import fcntl

        try:
            fcntl.flock(self.fd, fcntl.LOCK_UN)
        finally:
            os.close(self.fd)
            self.fd = None

    def clear(self) -> None:
        _unlink_quiet(maintenance_gate_path(self.db_path))
        self.release_lock_only()
        _unlink_quiet(maintenance_lock_path(self.db_path))


def _require_journal(journal: object, db_path: Path) -> None:
    if not isinstance(journal, dict) or journal.get("version") != 1:
        raise JoehubError("restore handover journal is unreadable")
    if str(journal.get("live_db")) != str(db_path):
        raise JoehubError("restore handover journal is for a different database")
    for key in (
        "incoming_sha256",
        "original_sha256",
        "nonce",
        "staged_token_path",
        "operator_token_path",
        "staged_digest",
        "original_db",
        "incoming_db",
    ):
        if not journal.get(key) and key != "original_sha256":
            raise JoehubError("restore handover journal is incomplete")


def _update(path: Path, journal: dict, *, phase: str) -> None:
    journal["phase"] = phase
    _write_json(path, journal)


def _read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise JoehubError("restore handover journal is unreadable") from exc
    if not isinstance(data, dict):
        raise JoehubError("restore handover journal is unreadable")
    return data


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}")
    data = json.dumps(payload, sort_keys=True).encode("utf-8")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(fd, data)
        os.fsync(fd)
    except Exception:
        os.close(fd)
        temporary.unlink(missing_ok=True)
        raise
    os.close(fd)
    os.replace(temporary, path)
    _fsync_dir(path.parent)


def _copy_fsync(src: Path, dest: Path) -> None:
    raw = src.read_bytes()
    temporary = dest.with_name(f".{dest.name}.{uuid.uuid4().hex}")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(fd, raw)
        os.fsync(fd)
    except Exception:
        os.close(fd)
        temporary.unlink(missing_ok=True)
        raise
    os.close(fd)
    os.replace(temporary, dest)
    _fsync_dir(dest.parent)


def _fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _unlink_quiet(path: Path) -> None:
    try:
        if path.exists() or path.is_symlink():
            path.unlink()
    except FileNotFoundError:
        return


def _unlink_db(path: Path) -> None:
    for suffix in ("", "-wal", "-shm"):
        _unlink_quiet(Path(str(path) + suffix))
