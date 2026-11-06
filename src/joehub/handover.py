"""Durable restore handover.

The exclusive SQLite lock is held on the old inode. ``os.replace`` publishes a
new inode that lock does not cover, and the rotated operator credential is a
second file. A crash or a competing opener in that gap must not observe a
database whose hashes do not match the token on disk, and must not destroy the
only copy of the previous database before the new pair is valid.

Exclusion is the maintenance flock, taken before any shared staging or checks.
Openers hold it shared across connect. The restorer holds it exclusive through
credential install. A durable ``completed`` phase is fsynced before any
success-path unlink. The journal is removed only after the gate, and a
completed record survives that unlink so cleanup can be restarted, including
when recovery itself crashes between steps.

The original's hash is not published as final until after the WAL checkpoint.
Until that refresh, the journal phase is ``checkpoint_pending`` and
``original_sha256`` is the pre-checkpoint hash. Recovery of that phase keeps
the live file, including when the checkpoint changed its bytes.
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

# Test seam. Fires immediately before each success-path unlink, including
# when recovery restarts that cleanup.
_cleanup_boundary: Callable[[str], None] | None = None

# Test seam. Fires immediately before a restore blocks on the exclusive lock.
_before_exclusive_lock: Callable[[], None] | None = None

# Test seam. Fires after the WAL checkpoint returns and before the journal's
# original hash is refreshed. A crash there leaves a checkpointed original
# whose bytes no longer match the pre-checkpoint hash.
_after_checkpoint: Callable[[], None] | None = None


def handover_journal_path(db_path: Path) -> Path:
    return Path(str(db_path) + ".handover.json")


def handover_completed_path(db_path: Path) -> Path:
    return Path(str(db_path) + ".handover.completed")


def original_copy_path(db_path: Path) -> Path:
    return Path(str(db_path) + ".original")


def handover_pending(db_path: Path) -> bool:
    return (
        maintenance_gate_path(db_path).is_file()
        or handover_journal_path(db_path).is_file()
        or handover_completed_path(db_path).is_file()
    )


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
    gate: _Gate | None = None
    holder: sqlite3.Connection | None = None
    replaced = False
    journal: dict | None = None
    journal_path = handover_journal_path(live)
    staged_path: Path | None = None
    previous_path: Path | None = None
    try:
        gate = _Gate.lock(live)
        recover_restore_handover(live, already_exclusive=True)
        if maintenance_gate_path(live).exists() or journal_path.exists():
            raise JoehubError("database is in a restore handover; refusing to open")
        nonce = uuid.uuid4().hex + uuid.uuid4().hex
        token_path = operator_token_path(settings)
        staged_path = token_path.with_name(f"operator.token.staged.{nonce}")
        previous_path = token_path.with_name(f"operator.token.previous.{nonce}")
        staged_secret = _stage_credential(settings, minted, staged_path, previous_path)
        had_live = live.is_file()
        original_sha = _sha256(live) if had_live else ""
        incoming_sha = _sha256(incoming)
        original = original_copy_path(live)
        journal = {
            "version": 1,
            "phase": "prepared",
            "live_db": str(live),
            "incoming_db": str(incoming),
            "original_db": str(original),
            "original_sha256": original_sha,
            "incoming_sha256": incoming_sha,
            "staged_token_path": str(staged_path),
            "previous_token_path": str(previous_path),
            "operator_token_path": str(token_path),
            "nonce": nonce,
            "had_live_db": had_live,
            "staged_digest": token_digest(staged_secret),
        }
        _write_json(journal_path, journal)
        gate.publish(nonce)
        if had_live:
            # The checkpoint rewrites the main file when a crashed writer left
            # a WAL. Publish that fact before the checkpoint so a crash before
            # the hash refresh is recoverable. ``original_sha256`` is still the
            # pre-checkpoint hash until the refresh below.
            _update(journal_path, journal, phase="checkpoint_pending")
            holder = _hold_exclusive(live, nonce)
            if _after_checkpoint is not None:
                _after_checkpoint()
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
        else:
            _update(journal_path, journal, phase="gated")
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
        _update(journal_path, journal, phase="completed")
        _finish_completed(journal, journal_path)
    except BaseException:
        # A checkpoint_pending journal is the crash record. Leave it for the
        # next opener instead of aborting against the stale pre-checkpoint hash.
        if (
            not replaced
            and journal is not None
            and journal.get("phase") != "checkpoint_pending"
        ):
            _settle_aborted(journal, journal_path)
        elif not replaced and journal is None:
            if staged_path is not None:
                _unlink_quiet(staged_path)
            if previous_path is not None:
                _unlink_quiet(previous_path)
        raise
    finally:
        if holder is not None:
            holder.close()
        if gate is not None:
            gate.release_lock_only()


def recover_restore_handover(db_path: Path, *, already_exclusive: bool = False) -> bool:
    """Finish or roll back a handover whose owner has died.

    Returns True when a journal was completed or discarded. Returns False when
    there is nothing to do, or another live owner still holds the gate.
    ``already_exclusive`` means the caller holds the maintenance flock.
    """
    if getattr(_in_recover, "on", False):
        return False
    if not handover_pending(db_path):
        return False
    if already_exclusive:
        _in_recover.on = True
        try:
            _recover_locked(db_path)
        finally:
            _in_recover.on = False
        return True
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
            _recover_locked(db_path)
            return True
        finally:
            _in_recover.on = False
            import fcntl

            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def _recover_locked(db_path: Path) -> None:
    journal_path = handover_journal_path(db_path)
    completed_path = handover_completed_path(db_path)
    if journal_path.is_file():
        journal = _read_json(journal_path)
        _require_journal(journal, db_path)
        _recover_journal(journal, journal_path, db_path)
        return
    if completed_path.is_file():
        journal = _read_json(completed_path)
        _require_journal(journal, db_path)
        journal["phase"] = "completed"
        _finish_completed(journal, journal_path)
        return
    if maintenance_gate_path(db_path).is_file():
        raise JoehubError("restore gate has no handover journal; refusing to open")


def _recover_journal(journal: dict, journal_path: Path, db_path: Path) -> None:
    phase = journal.get("phase")
    if phase == "completed":
        _finish_completed(journal, journal_path)
        return
    if phase == "aborted":
        _abort_files(journal)
        _unlink_quiet(maintenance_gate_path(db_path))
        _unlink_quiet(journal_path)
        _unlink_quiet(handover_completed_path(db_path))
        return
    if phase == "checkpoint_pending":
        _abort_checkpoint_pending(journal, journal_path)
        return
    live = Path(str(journal["live_db"]))
    live_sha = _sha256(live) if live.is_file() else ""
    if phase in {"db_installed", "token_installed"} or (
        live_sha != "" and live_sha == journal["incoming_sha256"]
    ):
        _complete_installed(journal, journal_path)
        return
    if journal.get("had_live_db") and live_sha == journal["original_sha256"]:
        _settle_aborted(journal, journal_path)
        return
    if not journal.get("had_live_db") and not live_sha:
        _settle_aborted(journal, journal_path)
        return
    raise JoehubError("restore handover is inconsistent; refusing to open")


def _complete_installed(journal: dict, journal_path: Path) -> None:
    if journal.get("phase") == "completed":
        _finish_completed(journal, journal_path)
        return
    _install_staged_token(journal)
    if not _token_matches(journal):
        if journal.get("had_live_db"):
            _rollback_original(journal)
            _settle_aborted(journal, journal_path)
            return
        raise JoehubError("restored database does not match the staged operator credential")
    _update(journal_path, journal, phase="completed")
    _finish_completed(journal, journal_path)


def _finish_completed(journal: dict, journal_path: Path) -> None:
    """Idempotent cleanup after the handover pair is valid.

    The completed phase and a sibling completed record are durable before any
    unlink. Each step can crash and be repeated. The journal is unlinked only
    after the gate, and the completed record is unlinked last.
    """
    journal["phase"] = "completed"
    live = Path(journal["live_db"])
    completed = handover_completed_path(live)
    if not journal_path.is_file():
        _write_json(journal_path, journal)
    else:
        _update(journal_path, journal, phase="completed")
    _write_json(completed, journal)
    _boundary("before_unlink_original")
    _unlink_quiet(Path(journal["original_db"]))
    for suffix in ("-wal", "-shm"):
        _unlink_quiet(Path(str(journal["original_db"]) + suffix))
    _unlink_quiet(Path(str(live) + ".rejected"))
    _boundary("before_unlink_staged")
    _unlink_quiet(Path(journal["staged_token_path"]))
    _boundary("before_unlink_previous")
    _unlink_quiet(Path(journal["previous_token_path"]))
    _boundary("before_unlink_gate")
    _unlink_quiet(maintenance_gate_path(live))
    _boundary("before_unlink_journal")
    _unlink_quiet(journal_path)
    _boundary("before_unlink_completed")
    _unlink_quiet(completed)


def _boundary(name: str) -> None:
    hook = _cleanup_boundary
    if hook is not None:
        hook(name)


def _settle_aborted(journal: dict, journal_path: Path) -> None:
    """Record an abort, then drop leftovers. The journal outlives the gate."""
    _update(journal_path, journal, phase="aborted")
    _abort_files(journal)
    db_path = Path(journal["live_db"])
    _unlink_quiet(maintenance_gate_path(db_path))
    _unlink_quiet(journal_path)
    _unlink_quiet(handover_completed_path(db_path))


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


def _restore_previous_token(journal: dict) -> None:
    previous = Path(journal["previous_token_path"])
    if previous.is_file():
        write_token_file(
            Path(journal["operator_token_path"]),
            previous.read_text(encoding="utf-8").strip(),
        )


def _rollback_original(journal: dict) -> None:
    live = Path(journal["live_db"])
    original = Path(journal["original_db"])
    live_sha = _sha256(live) if live.is_file() else ""
    if live_sha != "" and live_sha == journal["original_sha256"]:
        _restore_previous_token(journal)
        _unlink_quiet(original)
        for suffix in ("-wal", "-shm"):
            _unlink_quiet(Path(str(original) + suffix))
        return
    if not original.is_file():
        raise JoehubError("original database copy is missing; refusing to roll back blindly")
    rejected = Path(str(live) + ".rejected")
    if live.exists():
        os.replace(live, rejected)
    _copy_fsync(original, live)
    _restore_previous_token(journal)
    if _sha256(live) == journal["original_sha256"]:
        _unlink_quiet(original)
        for suffix in ("-wal", "-shm"):
            _unlink_quiet(Path(str(original) + suffix))


def _abort_checkpoint_pending(journal: dict, journal_path: Path) -> None:
    """Drop a handover that died during the original's WAL checkpoint.

    The live file is still the original database. Checkpointing may have
    merged a leftover WAL into it, so its hash need not match the
    pre-checkpoint ``original_sha256``. The file is left untouched.
    """
    live = Path(journal["live_db"])
    if journal.get("had_live_db") and not live.is_file():
        raise JoehubError("restore handover is inconsistent; refusing to open")
    incoming = Path(journal["incoming_db"])
    if incoming.resolve() != live.resolve():
        _unlink_db(incoming)
    original = Path(journal["original_db"])
    if original.resolve() != live.resolve():
        _unlink_quiet(original)
        for suffix in ("-wal", "-shm"):
            _unlink_quiet(Path(str(original) + suffix))
    _unlink_quiet(Path(journal["staged_token_path"]))
    _unlink_quiet(Path(journal["previous_token_path"]))
    _unlink_quiet(maintenance_gate_path(live))
    _unlink_quiet(journal_path)
    _unlink_quiet(handover_completed_path(live))


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


def _stage_credential(settings: Settings, minted: str | None, staged: Path, previous: Path) -> str:
    path = operator_token_path(settings)
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
            hook = _before_exclusive_lock
            if hook is not None:
                hook()
            fcntl.flock(fd, fcntl.LOCK_EX)
        except BaseException:
            os.close(fd)
            raise
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
        "previous_token_path",
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
