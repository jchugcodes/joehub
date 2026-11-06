"""Single-writer queue.

Every domain change takes the hall pass (a named lock with a TTL and a fencing
token), runs inside a transaction, and is recorded under an idempotency key
bound to the request fingerprint. Owner names are not credentials. Stale locks
can be taken over, which bumps the fence so the previous holder cannot commit.
Permanent failures are flagged in the errors table and the key is not applied
again.

Startup calls ``recover_incomplete``. One recovery thread per database retries
expired leases. The thread stops when the last ``WriteLayer`` using that
database closes. Recovery reloads the recorded principal and, for a human, the
delegation. It does not substitute the table owner for that principal.

Calling ``WriteLayer`` in-process is the default on a shared computer. It does
not enforce bot identity, and that identity is cooperative, not
tamper-resistant. The socket daemon in ``joehub.writer_service`` is an optional
strict mode, and only when each principal is a distinct uid. It refuses to
claim enforcement when principals share a uid. See ``docs/TRUST_BOUNDARY.md``.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass

from joehub.config import Settings, load_settings
from joehub.db import _maintenance_connect, connect, migrate
from joehub.errors import (
    PermanentWriteError,
    TransientWriteError,
    UnauthorizedError,
    ValidationError,
)
from joehub.principals import Principal, ensure_principals, resolve_credential
from joehub.registry import (
    ALLOWED_OWNERS,
    APPLICATION_EXTRAS,
    APPLICATION_STATUSES,
    EVENT_KINDS,
    HALL_PASS,
    OPERATIONS,
    TABLE_OWNERS,
    TABLES,
    Field,
    fields_by_name,
)
from joehub.util import add_seconds, canonical_uuid, is_timestamp, quote_ident, utcnow

log = logging.getLogger("joehub.write")


class RecoveryPool:
    """One recovery thread per database, shared by every ``WriteLayer`` on it."""

    _lock = threading.Lock()
    _entries: dict[str, "_RecoveryEntry"] = {}

    @classmethod
    def acquire(cls, settings: Settings) -> None:
        if settings.recovery_interval_seconds <= 0:
            return
        key = os.path.realpath(settings.db_path)
        with cls._lock:
            entry = cls._entries.get(key)
            if entry is None:
                entry = _RecoveryEntry(settings)
                cls._entries[key] = entry
                entry.start()
            entry.refs += 1

    @classmethod
    def release(cls, settings: Settings) -> None:
        if settings.recovery_interval_seconds <= 0:
            return
        key = os.path.realpath(settings.db_path)
        thread: threading.Thread | None = None
        with cls._lock:
            entry = cls._entries.get(key)
            if entry is None:
                return
            entry.refs -= 1
            if entry.refs <= 0:
                entry.stop.set()
                thread = entry.thread
                cls._entries.pop(key, None)
        if thread is not None and thread is not threading.current_thread() and thread.is_alive():
            thread.join(timeout=5)

    @classmethod
    def worker_count(cls) -> int:
        with cls._lock:
            return sum(1 for entry in cls._entries.values() if entry.thread is not None and entry.thread.is_alive())


class _RecoveryEntry:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.refs = 0
        self.stop = threading.Event()
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        self.thread = threading.Thread(target=self._loop, name="joehub-recovery", daemon=True)
        self.thread.start()

    def _loop(self) -> None:
        interval = self.settings.recovery_interval_seconds
        while not self.stop.wait(interval):
            try:
                layer = WriteLayer(self.settings, recover=False)
                try:
                    layer.recover_incomplete()
                finally:
                    layer.close()
            except Exception:
                log.warning("recovery pass failed", exc_info=True)


@dataclass(frozen=True)
class WriteRequest:
    principal_id: str
    principal_name: str
    principal_kind: str
    owner: str
    table: str
    operation: str
    payload: dict
    idempotency_key: str
    fingerprint: str


@dataclass(frozen=True)
class WriteResult:
    row_id: str | None
    replayed: bool
    status: str
    table: str
    operation: str


class WriteLayer:
    def __init__(self, settings: Settings | None = None, *, recover: bool = True):
        self.settings = settings or load_settings()
        migrate(self.settings.db_path)
        ensure_principals(self.settings)
        self.holder_id = f"{os_pid()}:{uuid.uuid4()}"
        self.fence: int | None = None
        self._pool_held = False
        if recover:
            self.recover_incomplete()
            if self.settings.recovery_interval_seconds > 0:
                RecoveryPool.acquire(self.settings)
                self._pool_held = True

    def close(self) -> None:
        if self._pool_held:
            self._pool_held = False
            RecoveryPool.release(self.settings)

    def write(
        self,
        *,
        credential: str,
        table: str,
        operation: str,
        payload: dict,
        idempotency_key: str,
    ) -> WriteResult:
        try:
            principal = resolve_credential(self.settings, credential)
        except UnauthorizedError as exc:
            self._audit_unauthenticated(exc)
            raise
        return self.write_as_principal(
            principal,
            table=table,
            operation=operation,
            payload=payload,
            idempotency_key=idempotency_key,
        )

    def write_as_principal(
        self,
        principal: Principal,
        *,
        table: str,
        operation: str,
        payload: dict,
        idempotency_key: str,
    ) -> WriteResult:
        """Apply a write for a principal the caller already authenticated.

        The socket daemon uses this after ``SO_PEERCRED``. The method itself is
        not a boundary: any code that can call it can name a principal.
        """
        try:
            request = self._authorize_principal(principal, table, operation, payload, idempotency_key)
        except _Rejected as rejected:
            self._safe_persist(rejected.request, rejected.original)
            raise rejected.original
        except UnauthorizedError as exc:
            self._audit_unauthenticated(exc)
            raise
        return self._run(request)

    def delegate(self, credential: str, owner_name: str) -> str:
        """Record an explicit human delegation. Owner and bot credentials cannot call this."""
        principal = resolve_credential(self.settings, credential)
        return self.delegate_as_principal(principal, owner_name)

    def delegate_as_principal(self, principal: Principal, owner_name: str) -> str:
        """Record a delegation for a human principal identified by the daemon."""
        if principal.kind != "human":
            raise UnauthorizedError("only a human can delegate; bots cannot impersonate an owner")
        if owner_name not in ALLOWED_OWNERS:
            raise UnauthorizedError("unknown owner")
        acquired = self._acquire_hall_pass(principal.name)
        if not acquired:
            raise TransientWriteError("hall pass is held")
        try:
            conn = _maintenance_connect(self.settings.db_path)
            try:
                conn.execute("BEGIN IMMEDIATE")
                self._touch_lease(conn)
                existing = conn.execute(
                    """
                    SELECT id FROM delegations
                    WHERE human_principal_id = ? AND owner_name = ? AND revoked_at IS NULL
                    """,
                    (principal.id, owner_name),
                ).fetchone()
                if existing is not None:
                    conn.rollback()
                    return str(existing["id"])
                now = utcnow()
                delegation_id = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO delegations (
                        id, notion_id, migrated_on, last_modified_by, last_modified_at,
                        human_principal_id, owner_name, granted_at, revoked_at, note
                    ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?)
                    """,
                    (
                        delegation_id,
                        principal.name,
                        now,
                        principal.id,
                        owner_name,
                        now,
                        "explicit human delegation",
                    ),
                )
                conn.commit()
                return delegation_id
            except Exception:
                _rollback_quiet(conn)
                raise
            finally:
                conn.close()
        finally:
            self._release_hall_pass()

    def revoke_delegation(self, credential: str, owner_name: str) -> None:
        """Revoke the human's active delegation. Owner credentials cannot call this."""
        principal = resolve_credential(self.settings, credential)
        self.revoke_as_principal(principal, owner_name)

    def revoke_as_principal(self, principal: Principal, owner_name: str) -> None:
        """Revoke a delegation for a human principal identified by the daemon."""
        if principal.kind != "human":
            raise UnauthorizedError("only a human can revoke a delegation")
        if owner_name not in ALLOWED_OWNERS:
            raise UnauthorizedError("unknown owner")
        acquired = self._acquire_hall_pass(principal.name)
        if not acquired:
            raise TransientWriteError("hall pass is held")
        try:
            conn = _maintenance_connect(self.settings.db_path)
            try:
                conn.execute("BEGIN IMMEDIATE")
                self._touch_lease(conn)
                now = utcnow()
                updated = conn.execute(
                    """
                    UPDATE delegations
                    SET revoked_at = ?, last_modified_by = ?, last_modified_at = ?
                    WHERE human_principal_id = ? AND owner_name = ? AND revoked_at IS NULL
                    """,
                    (now, principal.name, now, principal.id, owner_name),
                )
                if updated.rowcount != 1:
                    conn.rollback()
                    raise ValidationError("no active delegation")
                conn.commit()
            except Exception:
                _rollback_quiet(conn)
                raise
            finally:
                conn.close()
        finally:
            self._release_hall_pass()

    def recover_incomplete(self) -> int:
        """Finish queue rows left ``running`` by a crashed writer. Does not take a new caller payload."""
        conn = connect(self.settings.db_path)
        try:
            rows = conn.execute(
                "SELECT * FROM write_queue WHERE status = 'running' ORDER BY created_at, id"
            ).fetchall()
        finally:
            conn.close()
        finished = 0
        for row in rows:
            if not self._lease_abandoned(row):
                continue
            if self._recover_row(row):
                finished += 1
        return finished

    def _lease_abandoned(self, _row: sqlite3.Row) -> bool:
        """A live unexpired hall pass still owns the attempt. Recovery waits it out."""
        conn = connect(self.settings.db_path)
        try:
            lock = conn.execute(
                "SELECT expires_at FROM locks WHERE lock_name = ?",
                (HALL_PASS,),
            ).fetchone()
        finally:
            conn.close()
        if lock is None:
            return True
        return str(lock["expires_at"]) <= utcnow()

    def _recover_row(self, row: sqlite3.Row) -> bool:
        fingerprint = row["request_fingerprint"]
        principal_id = row["actor_principal_id"]
        if not fingerprint or not principal_id:
            self._fail_recovered(row, "running request has no fingerprint")
            return False
        try:
            payload = json.loads(row["payload_json"])
        except json.JSONDecodeError:
            self._fail_recovered(row, "running request payload is unreadable")
            return False
        expected = request_fingerprint(
            principal_id=str(principal_id),
            owner=str(row["owner_name"]),
            table=str(row["table_name"]),
            operation=str(row["operation"]),
            payload=payload,
        )
        if not _digest_equal(expected, str(fingerprint)):
            self._fail_recovered(row, "running request fingerprint does not match its payload")
            return False
        principal = self._load_principal(str(principal_id))
        if principal is None:
            self._fail_recovered(row, "recorded principal is gone")
            return False
        owner = str(row["owner_name"])
        try:
            self._require_principal_may_write(principal, owner)
        except UnauthorizedError as exc:
            self._fail_recovered(row, str(exc))
            return False
        request = WriteRequest(
            principal_id=principal.id,
            principal_name=principal.name,
            principal_kind=principal.kind,
            owner=owner,
            table=str(row["table_name"]),
            operation=str(row["operation"]),
            payload=payload,
            idempotency_key=str(row["idempotency_key"]),
            fingerprint=str(fingerprint),
        )
        try:
            result = self._run(request)
        except PermanentWriteError:
            return False
        return result.status == "committed" and not result.replayed

    def _authorize_principal(
        self,
        principal: Principal,
        table: str,
        operation: str,
        payload: dict,
        idempotency_key: str,
    ) -> WriteRequest:
        owner = self._effective_owner(principal, table)
        fingerprint = ""
        if isinstance(payload, dict):
            try:
                fingerprint = request_fingerprint(
                    principal_id=principal.id,
                    owner=owner,
                    table=table,
                    operation=operation,
                    payload=payload,
                )
            except (TypeError, ValueError):
                fingerprint = ""
        request = WriteRequest(
            principal_id=principal.id,
            principal_name=principal.name,
            principal_kind=principal.kind,
            owner=owner,
            table=table,
            operation=operation,
            payload=payload if isinstance(payload, dict) else {},
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
        )
        try:
            self._validate_shape(request)
        except PermanentWriteError as exc:
            raise _Rejected(request, exc) from exc
        return request

    def _load_principal(self, principal_id: str) -> Principal | None:
        conn = connect(self.settings.db_path)
        try:
            row = conn.execute(
                "SELECT id, name, kind, owner_name FROM principals WHERE id = ?",
                (principal_id,),
            ).fetchone()
        finally:
            conn.close()
        if row is None:
            return None
        return Principal(
            id=str(row["id"]),
            name=str(row["name"]),
            kind=str(row["kind"]),
            owner_name=None if row["owner_name"] is None else str(row["owner_name"]),
        )

    def _require_principal_may_write(self, principal: Principal, owner: str) -> None:
        if principal.kind == "bot":
            raise UnauthorizedError("bots cannot impersonate an owner")
        if principal.kind == "owner":
            if principal.owner_name != owner:
                raise UnauthorizedError(f"{principal.name} cannot write for {owner}")
            return
        if principal.kind == "human":
            if not self._delegation_active(principal.id, owner):
                raise UnauthorizedError("delegation revoked")
            return
        raise UnauthorizedError("unknown principal")

    def _effective_owner(self, principal: Principal, table: str) -> str:
        if principal.kind == "bot":
            raise UnauthorizedError("bots cannot impersonate an owner")
        if table not in TABLES:
            raise UnauthorizedError(f"{table} is not a writable table")
        owner = TABLE_OWNERS[table]
        if owner not in ALLOWED_OWNERS:
            raise UnauthorizedError(f"{table} is not a writable table")
        if principal.kind == "owner":
            if principal.owner_name != owner:
                raise UnauthorizedError(f"{principal.name} cannot write {table}")
            return owner
        if principal.kind == "human":
            if not self._delegation_active(principal.id, owner):
                raise UnauthorizedError(f"no delegation from {principal.name} to {owner}")
            return owner
        raise UnauthorizedError("unknown principal")

    def _delegation_active(self, principal_id: str, owner_name: str) -> bool:
        conn = connect(self.settings.db_path)
        try:
            row = conn.execute(
                """
                SELECT 1 FROM delegations
                WHERE human_principal_id = ? AND owner_name = ? AND revoked_at IS NULL
                """,
                (principal_id, owner_name),
            ).fetchone()
            return row is not None
        finally:
            conn.close()

    def _run(self, request: WriteRequest) -> WriteResult:
        existing = self._peek_queue(request.idempotency_key)
        if existing is not None and existing["status"] == "committed":
            self._require_same_fingerprint(existing, request)
            return self._replay(request, existing)
        if existing is not None and existing["status"] == "failed":
            raise PermanentWriteError(self._failed_message(existing))

        last_transient: TransientWriteError | None = None
        for attempt in range(1, self.settings.max_retries + 1):
            acquired = False
            try:
                acquired = self._acquire_hall_pass(request.principal_name)
                if not acquired:
                    raise TransientWriteError("hall pass is held")
                self._renew_lease()
                state, row = self._mark_running(request)
                if state == "committed" and row is not None:
                    return self._replay(request, row)
                if state == "conflict":
                    raise PermanentWriteError(
                        "idempotency key was already used for a different request"
                    )
                if state == "failed":
                    raise PermanentWriteError(self._failed_message(row))
                if state == "exhausted":
                    raise PermanentWriteError("bounded retry exceeded for this idempotency key")
                try:
                    row_id = self._apply_and_commit(request)
                except TransientWriteError:
                    raise
                except PermanentWriteError:
                    raise
                except sqlite3.OperationalError as exc:
                    if _is_busy(exc):
                        raise TransientWriteError(str(exc)) from exc
                    raise PermanentWriteError(str(exc)) from exc
                except Exception as exc:
                    raise PermanentWriteError(str(exc)) from exc
                return WriteResult(
                    row_id=row_id,
                    replayed=False,
                    status="committed",
                    table=request.table,
                    operation=request.operation,
                )
            except TransientWriteError as exc:
                last_transient = exc
                time.sleep(self.settings.retry_backoff_seconds * attempt)
                continue
            except PermanentWriteError as exc:
                self._safe_persist(request, exc)
                raise
            finally:
                if acquired:
                    self._release_hall_pass()

        exhausted = PermanentWriteError(f"retries exhausted: {last_transient}")
        self._safe_persist(request, exhausted)
        raise exhausted

    def _connect(self) -> sqlite3.Connection:
        return _maintenance_connect(self.settings.db_path)

    def _replay(self, request: WriteRequest, row: sqlite3.Row) -> WriteResult:
        self._require_same_fingerprint(row, request)
        return WriteResult(
            row_id=row["row_id"],
            replayed=True,
            status="committed",
            table=request.table,
            operation=request.operation,
        )

    @staticmethod
    def _require_same_fingerprint(row: sqlite3.Row, request: WriteRequest) -> None:
        stored = row["request_fingerprint"]
        if stored is None or not _digest_equal(str(stored), request.fingerprint):
            raise PermanentWriteError("idempotency key was already used for a different request")

    def _validate_shape(self, request: WriteRequest) -> None:
        if request.owner not in ALLOWED_OWNERS:
            raise UnauthorizedError("only Ledger, Scout, and Cato may write")
        if request.table not in TABLES:
            raise UnauthorizedError(f"{request.table} is not a writable table")
        if request.operation not in OPERATIONS:
            raise ValidationError("unsupported operation")
        if not isinstance(request.payload, dict):
            raise ValidationError("payload must be an object")
        key = request.idempotency_key
        if not isinstance(key, str) or key != key.strip() or not key or len(key) > 200 or "\n" in key:
            raise ValidationError("invalid idempotency key")
        try:
            json.dumps(request.payload)
        except TypeError as exc:
            raise ValidationError("payload is not JSON serializable") from exc

        if request.operation in {"delete_request", "delete_confirm"}:
            if set(request.payload) != {"id"}:
                raise ValidationError("delete payload must contain only id")
            canonical_uuid(request.payload["id"])
            return

        allowed = set(fields_by_name(request.table)) | {"id", "notion_id", "migrated_on"}
        if request.table == "applications":
            allowed |= APPLICATION_EXTRAS
        for name in request.payload:
            if name not in allowed:
                raise ValidationError(f"unknown field {name}")
        if "id" in request.payload and request.payload["id"] is not None:
            canonical_uuid(request.payload["id"])
        _validate_audit_inputs(request.payload)
        if request.table == "applications":
            if "event_kind" in request.payload and request.payload["event_kind"] not in EVENT_KINDS:
                raise ValidationError("event_kind must be migration_baseline or transition")
            if "occurred_at" in request.payload and not is_timestamp(request.payload["occurred_at"]):
                raise ValidationError("occurred_at must be a UTC timestamp YYYY-MM-DDTHH:MM:SSZ")

        if request.operation == "update":
            if "id" not in request.payload:
                raise ValidationError("update requires id")
            mutable = [name for name in request.payload if name != "id"]
            if not mutable:
                raise ValidationError("update requires at least one field")
            return

        for field in TABLES[request.table]:
            if field.name in request.payload:
                coerce_field(field, request.payload[field.name])
            elif field.required and not field.has_default:
                raise ValidationError(f"{field.name} is required")

    def _peek_queue(self, idempotency_key: str) -> sqlite3.Row | None:
        conn = self._connect()
        try:
            return conn.execute(
                "SELECT * FROM write_queue WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
        finally:
            conn.close()

    def _acquire_hall_pass(self, actor: str) -> bool:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            now = utcnow()
            expires = _add_seconds(now, self.settings.lock_ttl_seconds)
            row = conn.execute(
                "SELECT holder_id, expires_at, fence FROM locks WHERE lock_name = ?",
                (HALL_PASS,),
            ).fetchone()
            if row is None:
                self.fence = 1
                conn.execute(
                    """
                    INSERT INTO locks (
                        id, notion_id, migrated_on, last_modified_by, last_modified_at,
                        lock_name, holder_id, acquired_at, expires_at, ttl_seconds, fence
                    ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        actor,
                        now,
                        HALL_PASS,
                        self.holder_id,
                        now,
                        expires,
                        self.settings.lock_ttl_seconds,
                        self.fence,
                    ),
                )
            elif row["holder_id"] == self.holder_id and row["expires_at"] > now:
                self.fence = int(row["fence"])
                conn.execute(
                    """
                    UPDATE locks
                    SET expires_at = ?, ttl_seconds = ?, last_modified_by = ?, last_modified_at = ?
                    WHERE lock_name = ? AND holder_id = ? AND fence = ?
                    """,
                    (
                        expires,
                        self.settings.lock_ttl_seconds,
                        actor,
                        now,
                        HALL_PASS,
                        self.holder_id,
                        self.fence,
                    ),
                )
            elif row["holder_id"] == self.holder_id or row["expires_at"] <= now:
                self.fence = int(row["fence"]) + 1
                conn.execute(
                    """
                    UPDATE locks
                    SET holder_id = ?, acquired_at = ?, expires_at = ?, ttl_seconds = ?,
                        last_modified_by = ?, last_modified_at = ?, fence = ?
                    WHERE lock_name = ? AND fence = ?
                    """,
                    (
                        self.holder_id,
                        now,
                        expires,
                        self.settings.lock_ttl_seconds,
                        actor,
                        now,
                        self.fence,
                        HALL_PASS,
                        int(row["fence"]),
                    ),
                )
            else:
                conn.rollback()
                return False
            conn.commit()
            return True
        except sqlite3.IntegrityError:
            _rollback_quiet(conn)
            return False
        except sqlite3.OperationalError:
            _rollback_quiet(conn)
            return False
        finally:
            conn.close()

    def _renew_lease(self) -> None:
        conn = _maintenance_connect(self.settings.db_path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            self._touch_lease(conn)
            conn.commit()
        except Exception:
            _rollback_quiet(conn)
            raise
        finally:
            conn.close()

    def _touch_lease(self, conn: sqlite3.Connection) -> None:
        if self.fence is None:
            raise TransientWriteError("lost the hall pass")
        now = utcnow()
        expires = add_seconds(now, self.settings.lock_ttl_seconds)
        updated = conn.execute(
            """
            UPDATE locks
            SET expires_at = ?, ttl_seconds = ?, last_modified_at = ?
            WHERE lock_name = ? AND holder_id = ? AND fence = ?
            """,
            (expires, self.settings.lock_ttl_seconds, now, HALL_PASS, self.holder_id, self.fence),
        )
        if updated.rowcount != 1:
            raise TransientWriteError("lost the hall pass")

    def _release_hall_pass(self) -> None:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                "DELETE FROM locks WHERE lock_name = ? AND holder_id = ?",
                (HALL_PASS, self.holder_id),
            )
            conn.commit()
        except sqlite3.Error:
            _rollback_quiet(conn)
        finally:
            conn.close()

    def _mark_running(self, request: WriteRequest) -> tuple[str, sqlite3.Row | None]:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT * FROM write_queue WHERE idempotency_key = ?",
                (request.idempotency_key,),
            ).fetchone()
            if row is not None and row["status"] == "committed":
                conn.rollback()
                return "committed", row
            if row is not None and row["status"] == "failed":
                conn.rollback()
                return "failed", row
            if row is not None and int(row["attempt_count"]) >= self.settings.max_retries:
                conn.rollback()
                return "exhausted", row
            if row is not None:
                stored = row["request_fingerprint"]
                if stored is None or not _digest_equal(str(stored), request.fingerprint):
                    conn.rollback()
                    return "conflict", row
            now = utcnow()
            if row is None:
                payload_json = json.dumps(request.payload, sort_keys=True, separators=(",", ":"))
                conn.execute(
                    """
                    INSERT INTO write_queue (
                        id, notion_id, migrated_on, last_modified_by, last_modified_at,
                        idempotency_key, owner_name, table_name, operation, payload_json,
                        status, row_id, attempt_count, created_at, completed_at,
                        request_fingerprint, actor_principal_id, fence
                    ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, 1, ?, NULL, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        request.owner,
                        now,
                        request.idempotency_key,
                        request.owner,
                        request.table,
                        request.operation,
                        payload_json,
                        now,
                        request.fingerprint,
                        request.principal_id,
                        self.fence,
                    ),
                )
            else:
                conn.execute(
                    """
                    UPDATE write_queue
                    SET status = 'running',
                        attempt_count = attempt_count + 1,
                        last_modified_by = ?,
                        last_modified_at = ?,
                        fence = ?
                    WHERE idempotency_key = ? AND request_fingerprint = ?
                    """,
                    (
                        request.owner,
                        now,
                        self.fence,
                        request.idempotency_key,
                        request.fingerprint,
                    ),
                )
            conn.commit()
            return "running", row
        except sqlite3.OperationalError as exc:
            _rollback_quiet(conn)
            if _is_busy(exc):
                raise TransientWriteError(str(exc)) from exc
            raise
        except sqlite3.IntegrityError as exc:
            _rollback_quiet(conn)
            raise TransientWriteError(str(exc)) from exc
        finally:
            conn.close()

    def _apply_and_commit(self, request: WriteRequest) -> str:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            try:
                self._touch_lease(conn)
                self._revalidate_actor(conn, request)
                self._assert_owner(conn, request)
                row_id = self._dispatch(conn, request)
                self._touch_lease(conn)
                now = utcnow()
                updated = conn.execute(
                    """
                    UPDATE write_queue
                    SET status = 'committed', row_id = ?, completed_at = ?,
                        last_modified_by = ?, last_modified_at = ?
                    WHERE idempotency_key = ? AND status = 'running' AND request_fingerprint = ?
                    """,
                    (row_id, now, request.owner, now, request.idempotency_key, request.fingerprint),
                )
                if updated.rowcount != 1:
                    raise TransientWriteError("lost the hall pass")
                conn.commit()
                return row_id
            except Exception:
                _rollback_quiet(conn)
                raise
        finally:
            conn.close()

    def _revalidate_actor(self, conn: sqlite3.Connection, request: WriteRequest) -> None:
        """Re-check the recorded principal and, for a human, the live delegation.

        Uses the caller's connection so a write transaction does not open a
        second connection while it holds the database lock.
        """
        row = conn.execute(
            "SELECT id, name, kind, owner_name FROM principals WHERE id = ?",
            (request.principal_id,),
        ).fetchone()
        if row is None:
            raise UnauthorizedError("recorded principal is gone")
        kind = str(row["kind"])
        if kind == "bot":
            raise UnauthorizedError("bots cannot impersonate an owner")
        if kind == "owner":
            owner_name = None if row["owner_name"] is None else str(row["owner_name"])
            if owner_name != request.owner:
                raise UnauthorizedError(f"{row['name']} cannot write for {request.owner}")
            return
        if kind != "human":
            raise UnauthorizedError("unknown principal")
        delegation = conn.execute(
            """
            SELECT 1 FROM delegations
            WHERE human_principal_id = ? AND owner_name = ? AND revoked_at IS NULL
            """,
            (request.principal_id, request.owner),
        ).fetchone()
        if delegation is None:
            raise UnauthorizedError("delegation revoked")

    def _assert_owner(self, conn: sqlite3.Connection, request: WriteRequest) -> None:
        row = conn.execute(
            """
            SELECT owners.name AS owner_name
            FROM table_registry
            JOIN owners ON owners.id = table_registry.owner_id
            WHERE table_registry.table_name = ?
            """,
            (request.table,),
        ).fetchone()
        if row is None or row["owner_name"] not in ALLOWED_OWNERS or row["owner_name"] != request.owner:
            raise UnauthorizedError(f"{request.owner} cannot write {request.table}")

    def _dispatch(self, conn: sqlite3.Connection, request: WriteRequest) -> str:
        if request.operation == "insert":
            return self._insert(conn, request)
        if request.operation == "update":
            return self._update(conn, request)
        if request.operation == "delete_request":
            return self._delete_request(conn, request)
        if request.operation == "delete_confirm":
            return self._delete_confirm(conn, request)
        raise ValidationError("unsupported operation")

    def _insert(self, conn: sqlite3.Connection, request: WriteRequest) -> str:
        payload = request.payload
        values: dict[str, object] = {
            "id": canonical_uuid(payload["id"]) if payload.get("id") else str(uuid.uuid4()),
            "notion_id": _optional_notion(payload),
            "migrated_on": _optional_migrated_on(payload),
        }
        for field in TABLES[request.table]:
            if request.table == "applications" and field.name in {"company_id", "contact_id"}:
                continue
            values[field.name] = _take_field(field, payload)
        if request.table == "applications":
            company_id = _resolve_company(conn, payload)
            contact_id = _resolve_contact(conn, payload, company_id)
            values["company_id"] = company_id
            values["contact_id"] = contact_id
        now = utcnow()
        values["last_modified_by"] = request.owner
        values["last_modified_at"] = now
        _check_ranges(request.table, values)
        _check_refs(conn, request.table, values)
        _insert_row(conn, request.table, values)
        if request.table == "applications":
            _insert_status_event(
                conn,
                application_id=str(values["id"]),
                from_status=None,
                to_status=str(values["status"]),
                event_kind=str(payload.get("event_kind") or "transition"),
                occurred_at=payload.get("occurred_at") if isinstance(payload.get("occurred_at"), str) else now,
                actor=request.owner,
            )
        return str(values["id"])

    def _update(self, conn: sqlite3.Connection, request: WriteRequest) -> str:
        payload = request.payload
        row_id = canonical_uuid(payload["id"])
        existing = _fetch_row(conn, request.table, row_id)
        if existing is None:
            raise ValidationError("row not found")
        changes: dict[str, object] = {}
        for field in TABLES[request.table]:
            if request.table == "applications" and field.name in {"company_id", "contact_id"}:
                continue
            if field.name in payload:
                changes[field.name] = coerce_field(field, payload[field.name])
        if "notion_id" in payload:
            changes["notion_id"] = _notion_value(payload["notion_id"])
        if "migrated_on" in payload:
            changes["migrated_on"] = _migrated_value(payload["migrated_on"])
        if request.table == "applications":
            if "company_id" in payload or "raw_company" in payload:
                changes["company_id"] = _resolve_company(conn, payload)
            if "contact_id" in payload or "raw_contact" in payload:
                company_id = changes.get("company_id", existing["company_id"])
                changes["contact_id"] = _resolve_contact(conn, payload, company_id)
        merged = dict(existing)
        merged.update(changes)
        _check_ranges(request.table, merged)
        _check_refs(conn, request.table, changes)
        now = utcnow()
        changes["last_modified_by"] = request.owner
        changes["last_modified_at"] = now
        _update_row(conn, request.table, row_id, changes)
        if request.table == "applications" and "status" in changes and changes["status"] != existing["status"]:
            _insert_status_event(
                conn,
                application_id=row_id,
                from_status=existing["status"],
                to_status=str(changes["status"]),
                event_kind=str(payload.get("event_kind") or "transition"),
                occurred_at=payload.get("occurred_at") if isinstance(payload.get("occurred_at"), str) else now,
                actor=request.owner,
            )
        return row_id

    def _delete_request(self, conn: sqlite3.Connection, request: WriteRequest) -> str:
        row_id = canonical_uuid(request.payload["id"])
        if _fetch_row(conn, request.table, row_id) is None:
            raise ValidationError("row not found")
        open_row = conn.execute(
            """
            SELECT id FROM pending_deletes
            WHERE table_name = ? AND row_id = ? AND status = 'pending'
            """,
            (request.table, row_id),
        ).fetchone()
        if open_row is not None:
            raise PermanentWriteError("delete already pending")
        now = utcnow()
        _insert_row(
            conn,
            "pending_deletes",
            {
                "id": str(uuid.uuid4()),
                "notion_id": None,
                "migrated_on": None,
                "last_modified_by": request.owner,
                "last_modified_at": now,
                "owner_name": request.owner,
                "table_name": request.table,
                "row_id": row_id,
                "requested_at": now,
                "confirmed_at": None,
                "status": "pending",
            },
        )
        return row_id

    def _delete_confirm(self, conn: sqlite3.Connection, request: WriteRequest) -> str:
        row_id = canonical_uuid(request.payload["id"])
        pending = conn.execute(
            """
            SELECT id FROM pending_deletes
            WHERE table_name = ? AND row_id = ? AND status = 'pending' AND owner_name = ?
            """,
            (request.table, row_id, request.owner),
        ).fetchone()
        if pending is None:
            raise PermanentWriteError("no pending delete for this owner and row")
        quoted = quote_ident(request.table)
        deleted = conn.execute(f"DELETE FROM {quoted} WHERE id = ?", (row_id,))
        if deleted.rowcount != 1:
            raise ValidationError("row not found")
        now = utcnow()
        conn.execute(
            """
            UPDATE pending_deletes
            SET status = 'confirmed', confirmed_at = ?, last_modified_by = ?, last_modified_at = ?
            WHERE id = ?
            """,
            (now, request.owner, now, pending["id"]),
        )
        return row_id

    def _fail_recovered(self, row: sqlite3.Row, message: str) -> None:
        now = utcnow()
        conn = _maintenance_connect(self.settings.db_path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                """
                UPDATE write_queue
                SET status = 'failed', completed_at = ?, last_modified_at = ?
                WHERE idempotency_key = ? AND status = 'running'
                """,
                (now, now, row["idempotency_key"]),
            )
            conn.execute(
                """
                INSERT INTO errors (
                    id, notion_id, migrated_on, last_modified_by, last_modified_at,
                    idempotency_key, owner_name, table_name, operation, message, persistent, created_at
                ) VALUES (?, NULL, NULL, 'system', ?, ?, ?, ?, ?, ?, 1, ?)
                """,
                (
                    str(uuid.uuid4()),
                    now,
                    row["idempotency_key"],
                    row["owner_name"],
                    row["table_name"],
                    row["operation"],
                    message,
                    now,
                ),
            )
            conn.commit()
        except sqlite3.Error:
            _rollback_quiet(conn)
        finally:
            conn.close()

    def _safe_persist(self, request: WriteRequest, exc: PermanentWriteError) -> None:
        try:
            self._persist_failure(request, exc)
        except Exception as persist_exc:
            raise PermanentWriteError(f"{exc} (also failed to record the error: {persist_exc})") from exc

    def _audit_unauthenticated(self, exc: PermanentWriteError) -> None:
        """Record a rejection without touching any queue row.

        The caller is not an authenticated principal, so the idempotency key
        they presented must not be attached to an existing or new queue entry.
        """
        message = str(exc).strip() or exc.__class__.__name__
        if len(message) > 2000:
            message = message[:2000]
        now = utcnow()
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO errors (
                    id, notion_id, migrated_on, last_modified_by, last_modified_at,
                    idempotency_key, owner_name, table_name, operation, message, persistent, created_at
                ) VALUES (?, NULL, NULL, 'system', ?, NULL, 'unknown', NULL, NULL, ?, 1, ?)
                """,
                (str(uuid.uuid4()), now, message, now),
            )
        except sqlite3.Error:
            return
        finally:
            conn.close()

    def _persist_failure(self, request: WriteRequest, exc: PermanentWriteError) -> None:
        message = str(exc).strip() or exc.__class__.__name__
        if len(message) > 2000:
            message = message[:2000]
        owner_name = request.owner if isinstance(request.owner, str) and request.owner else "unknown"
        table_name = request.table if isinstance(request.table, str) else None
        operation = request.operation if isinstance(request.operation, str) else None
        key = request.idempotency_key if isinstance(request.idempotency_key, str) else ""
        try:
            payload_json = json.dumps(request.payload, sort_keys=True, separators=(",", ":"))
        except TypeError:
            payload_json = "{}"
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            existing = None
            if key:
                existing = conn.execute(
                    """
                    SELECT status, request_fingerprint, actor_principal_id
                    FROM write_queue WHERE idempotency_key = ?
                    """,
                    (key,),
                ).fetchone()
            if existing is not None and not _same_authenticated_request(existing, request):
                conn.rollback()
                return
            if existing is not None and existing["status"] in {"committed", "failed"}:
                conn.rollback()
                return
            now = utcnow()
            conn.execute(
                """
                INSERT INTO errors (
                    id, notion_id, migrated_on, last_modified_by, last_modified_at,
                    idempotency_key, owner_name, table_name, operation, message, persistent, created_at
                ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                """,
                (
                    str(uuid.uuid4()),
                    owner_name,
                    now,
                    key or None,
                    owner_name,
                    table_name,
                    operation if operation in OPERATIONS else None,
                    message,
                    now,
                ),
            )
            if (
                key
                and _key_ok(key)
                and request.fingerprint
                and request.principal_id
                and operation in OPERATIONS
                and table_name
            ):
                if existing is not None:
                    conn.execute(
                        """
                        UPDATE write_queue
                        SET status = 'failed', completed_at = ?, last_modified_by = ?, last_modified_at = ?
                        WHERE idempotency_key = ?
                          AND actor_principal_id = ?
                          AND request_fingerprint = ?
                          AND status = 'running'
                        """,
                        (
                            now,
                            owner_name,
                            now,
                            key,
                            request.principal_id,
                            request.fingerprint,
                        ),
                    )
                else:
                    conn.execute(
                        """
                        INSERT INTO write_queue (
                            id, notion_id, migrated_on, last_modified_by, last_modified_at,
                            idempotency_key, owner_name, table_name, operation, payload_json,
                            status, row_id, attempt_count, created_at, completed_at,
                            request_fingerprint, actor_principal_id, fence
                        ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'failed', NULL, 1, ?, ?, ?, ?, NULL)
                        """,
                        (
                            str(uuid.uuid4()),
                            owner_name,
                            now,
                            key,
                            owner_name,
                            table_name,
                            operation,
                            payload_json,
                            now,
                            now,
                            request.fingerprint,
                            request.principal_id,
                        ),
                    )
            conn.commit()
        except sqlite3.IntegrityError:
            _rollback_quiet(conn)
        finally:
            conn.close()

    @staticmethod
    def _failed_message(row: sqlite3.Row | None) -> str:
        if row is None:
            return "idempotency key already failed"
        return "idempotency key already failed"


def coerce_field(field: Field, value: object) -> object:
    if value is None:
        if field.required:
            raise ValidationError(f"{field.name} is required")
        return None
    if field.kind == "text":
        if not isinstance(value, str):
            raise ValidationError(f"{field.name} must be text")
        if field.required and value == "":
            raise ValidationError(f"{field.name} is required")
        if field.choices is not None and value not in field.choices:
            allowed = ", ".join(field.choices)
            raise ValidationError(f"{field.name} must be one of: {allowed}")
        return value
    if field.kind == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValidationError(f"{field.name} must be an integer")
        if field.min_value is not None and value < field.min_value:
            raise ValidationError(f"{field.name} must be >= {field.min_value}")
        return value
    if field.kind == "date":
        if not isinstance(value, str):
            raise ValidationError(f"{field.name} must be YYYY-MM-DD")
        from datetime import datetime

        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError as exc:
            raise ValidationError(f"{field.name} must be YYYY-MM-DD") from exc
        return value
    if field.kind == "timestamp":
        if not is_timestamp(value):
            raise ValidationError(f"{field.name} must be a UTC timestamp YYYY-MM-DDTHH:MM:SSZ")
        return value
    if field.kind == "uuid":
        return canonical_uuid(value)
    raise ValidationError(f"unsupported field type for {field.name}")


def _take_field(field: Field, payload: dict) -> object:
    if field.name in payload:
        return coerce_field(field, payload[field.name])
    if field.has_default:
        return coerce_field(field, field.default)
    if field.required:
        raise ValidationError(f"{field.name} is required")
    return None


def _validate_audit_inputs(payload: dict) -> None:
    if "notion_id" in payload:
        _notion_value(payload["notion_id"])
    if "migrated_on" in payload:
        _migrated_value(payload["migrated_on"])


def _optional_notion(payload: dict) -> str | None:
    if "notion_id" not in payload:
        return None
    return _notion_value(payload["notion_id"])


def _optional_migrated_on(payload: dict) -> str | None:
    if "migrated_on" not in payload:
        return None
    return _migrated_value(payload["migrated_on"])


def _notion_value(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        raise ValidationError("notion_id must be text")
    return value


def _migrated_value(value: object) -> str | None:
    if value is None:
        return None
    if not is_timestamp(value):
        raise ValidationError("migrated_on must be a UTC timestamp YYYY-MM-DDTHH:MM:SSZ")
    return str(value)


def _check_refs(conn: sqlite3.Connection, table: str, values: dict) -> None:
    for field in TABLES[table]:
        if field.references is None or field.name not in values:
            continue
        value = values[field.name]
        if value is None:
            continue
        quoted = quote_ident(field.references)
        found = conn.execute(f"SELECT 1 FROM {quoted} WHERE id = ?", (value,)).fetchone()
        if found is None:
            raise ValidationError(f"unknown {field.name}")


def _check_ranges(table: str, values: dict) -> None:
    if table == "budgets":
        start = values.get("start_date")
        end = values.get("end_date")
        if start and end and str(end) < str(start):
            raise ValidationError("end_date is before start_date")
    if table == "events":
        start = values.get("starts_at")
        end = values.get("ends_at")
        if start and end and str(end) < str(start):
            raise ValidationError("ends_at is before starts_at")
    if table == "application_status_history":
        kind = values.get("event_kind")
        if kind is not None and kind not in EVENT_KINDS:
            raise ValidationError("invalid event_kind")
        for column in ("from_status", "to_status"):
            status = values.get(column)
            if status is not None and status not in APPLICATION_STATUSES:
                raise ValidationError(f"invalid {column}")


def _resolve_company(conn: sqlite3.Connection, payload: dict) -> str | None:
    if "company_id" in payload:
        raw_id = payload["company_id"]
        if raw_id is None:
            return None
        company_id = canonical_uuid(raw_id)
        found = conn.execute("SELECT 1 FROM companies WHERE id = ?", (company_id,)).fetchone()
        if found is None:
            raise ValidationError("unknown company_id")
        return company_id
    raw_name = payload.get("raw_company")
    if not isinstance(raw_name, str) or raw_name == "":
        return None
    rows = conn.execute("SELECT id FROM companies WHERE name = ?", (raw_name,)).fetchall()
    if len(rows) == 1:
        return rows[0]["id"]
    return None


def _resolve_contact(conn: sqlite3.Connection, payload: dict, company_id: object) -> str | None:
    if "contact_id" in payload:
        raw_id = payload["contact_id"]
        if raw_id is None:
            return None
        contact_id = canonical_uuid(raw_id)
        found = conn.execute("SELECT 1 FROM contacts WHERE id = ?", (contact_id,)).fetchone()
        if found is None:
            raise ValidationError("unknown contact_id")
        return contact_id
    raw_name = payload.get("raw_contact")
    if not isinstance(raw_name, str) or raw_name == "":
        return None
    if isinstance(company_id, str):
        rows = conn.execute(
            "SELECT id FROM contacts WHERE name = ? AND company_id = ?",
            (raw_name, company_id),
        ).fetchall()
    else:
        rows = conn.execute("SELECT id FROM contacts WHERE name = ?", (raw_name,)).fetchall()
    if len(rows) == 1:
        return rows[0]["id"]
    return None


def _insert_status_event(
    conn: sqlite3.Connection,
    *,
    application_id: str,
    from_status: str | None,
    to_status: str,
    event_kind: str,
    occurred_at: str,
    actor: str,
) -> None:
    if event_kind not in EVENT_KINDS:
        raise ValidationError("event_kind must be migration_baseline or transition")
    if to_status not in APPLICATION_STATUSES:
        raise ValidationError("invalid status")
    if from_status is not None and from_status not in APPLICATION_STATUSES:
        raise ValidationError("invalid from_status")
    if not is_timestamp(occurred_at):
        raise ValidationError("occurred_at must be a UTC timestamp YYYY-MM-DDTHH:MM:SSZ")
    now = utcnow()
    _insert_row(
        conn,
        "application_status_history",
        {
            "id": str(uuid.uuid4()),
            "notion_id": None,
            "migrated_on": None,
            "last_modified_by": actor,
            "last_modified_at": now,
            "application_id": application_id,
            "from_status": from_status,
            "to_status": to_status,
            "event_kind": event_kind,
            "occurred_at": occurred_at,
            "note": None,
        },
    )


def _fetch_row(conn: sqlite3.Connection, table: str, row_id: str) -> sqlite3.Row | None:
    quoted = quote_ident(table)
    return conn.execute(f"SELECT * FROM {quoted} WHERE id = ?", (row_id,)).fetchone()


def _insert_row(conn: sqlite3.Connection, table: str, values: dict) -> None:
    columns = list(values)
    for column in columns:
        quote_ident(column)
    quoted_table = quote_ident(table)
    collist = ", ".join(quote_ident(column) for column in columns)
    placeholders = ", ".join("?" for _ in columns)
    conn.execute(
        f"INSERT INTO {quoted_table} ({collist}) VALUES ({placeholders})",
        [values[column] for column in columns],
    )


def _update_row(conn: sqlite3.Connection, table: str, row_id: str, changes: dict) -> None:
    assignments = []
    params: list[object] = []
    for column, value in changes.items():
        assignments.append(f"{quote_ident(column)} = ?")
        params.append(value)
    params.append(row_id)
    sql = f"UPDATE {quote_ident(table)} SET {', '.join(assignments)} WHERE id = ?"
    updated = conn.execute(sql, params)
    if updated.rowcount != 1:
        raise ValidationError("row not found")


def _rollback_quiet(conn: sqlite3.Connection) -> None:
    try:
        conn.rollback()
    except sqlite3.Error:
        pass


def _is_busy(exc: sqlite3.OperationalError) -> bool:
    text = str(exc).lower()
    return "locked" in text or "busy" in text


def _add_seconds(stamp: str, seconds: int) -> str:
    from joehub.util import add_seconds

    return add_seconds(stamp, seconds)


class _Rejected(Exception):
    def __init__(self, request: WriteRequest, original: PermanentWriteError):
        super().__init__(str(original))
        self.request = request
        self.original = original


def request_fingerprint(
    *,
    principal_id: str,
    owner: str,
    table: str,
    operation: str,
    payload: dict,
) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    material = "\n".join([principal_id, owner, table, operation, encoded])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _digest_equal(left: str, right: str) -> bool:
    if len(left) != len(right):
        return False
    return hmac.compare_digest(left, right)


def _key_ok(key: str) -> bool:
    return bool(key) and key == key.strip() and len(key) <= 200 and "\n" not in key


def _same_authenticated_request(existing: sqlite3.Row, request: WriteRequest) -> bool:
    """True only when this caller is the principal who stored this fingerprint."""
    if not request.principal_id or not request.fingerprint:
        return False
    if str(existing["actor_principal_id"] or "") != request.principal_id:
        return False
    stored = existing["request_fingerprint"]
    if not stored or not _digest_equal(str(stored), request.fingerprint):
        return False
    return True


def os_pid() -> int:
    import os

    return os.getpid()
