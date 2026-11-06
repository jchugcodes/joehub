"""Isolated writer daemon.

The process that opens the database is the writer uid. Clients connect to a
Unix socket. Their identity is ``SO_PEERCRED``, looked up in an access map the
writer owns. The request must not carry a credential, a principal name, or a
uid: those fields are rejected so a stolen token cannot impersonate anyone.

This process is not a principal boundary by itself. It refuses to listen unless
the access map gives every principal a distinct uid that is not the writer's,
the database is mode 0600 and owned by the writer, and the socket directory
cannot be replaced by group or other. On a machine where every bot is one uid,
no map satisfies that check. See ``docs/DEPLOYMENT_ACCESS.md``.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import threading
from pathlib import Path

from joehub.access import (
    AccessMap,
    assert_database_private,
    assert_distinct_principals,
    assert_private_file,
    assert_socket_directory,
    harden_database,
    load_access_map,
    read_peer_cred,
)
from joehub.config import Settings, load_settings
from joehub.errors import JoehubError, PermanentWriteError, TransientWriteError, UnauthorizedError, ValidationError
from joehub.principals import HUMAN_NAME, OWNER_NAMES, Principal, principal_by_name
from joehub.write import WriteLayer, WriteResult

log = logging.getLogger("joehub.writer")

_MAX_LINE = 1024 * 1024
_FORBIDDEN = frozenset(
    {"credential", "principal", "principal_id", "principal_name", "uid", "gid", "token", "owner", "owner_name"}
)
_ERROR_TYPES = {
    UnauthorizedError: "UnauthorizedError",
    ValidationError: "ValidationError",
    PermanentWriteError: "PermanentWriteError",
    TransientWriteError: "TransientWriteError",
    JoehubError: "JoehubError",
}


class WriterServer:
    def __init__(
        self,
        settings: Settings,
        access_map_path: Path,
        socket_path: Path,
        *,
        socket_mode: int = 0o660,
        socket_group: str | None = None,
    ):
        self.settings = settings
        self.access_map_path = access_map_path
        self.socket_path = socket_path
        self.socket_mode = socket_mode
        self.socket_group = socket_group
        self._stop = threading.Event()
        self._listen: socket.socket | None = None
        self._layer: WriteLayer | None = None
        self._access: AccessMap | None = None
        self._write_lock = threading.Lock()
        self._boot_error: BaseException | None = None

    def check_deployment(self) -> AccessMap:
        """Validate the map and the socket directory. The database may not exist yet."""
        access = load_access_map(self.access_map_path)
        assert_distinct_principals(access, os.geteuid())
        assert_private_file(self.access_map_path, os.geteuid())
        parent = self.socket_path.parent
        if not parent.exists():
            parent.mkdir(parents=True, mode=0o755)
            os.chmod(parent, 0o755)
        assert_socket_directory(parent, os.geteuid())
        return access

    def open_writer(self) -> None:
        """Open the database as this uid and refuse to continue unless clients cannot."""
        previous = os.umask(0o077)
        try:
            self._access = self.check_deployment()
            self._layer = WriteLayer(self.settings)
            harden_database(self.settings.db_path)
            assert_database_private(self.settings.db_path, os.geteuid())
        finally:
            os.umask(previous)

    def serve_forever(self, *, ready: threading.Event | None = None) -> None:
        sock: socket.socket | None = None
        previous_umask = os.umask(0o077)
        try:
            if self._layer is None or self._access is None:
                self.open_writer()
            assert self._access is not None
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            if self.socket_path.exists() or self.socket_path.is_socket():
                if not self.socket_path.is_socket():
                    raise JoehubError("socket path exists and is not a socket")
                self.socket_path.unlink()
            sock.bind(str(self.socket_path))
            self._chown_socket()
            os.chmod(self.socket_path, self.socket_mode)
            sock.listen(16)
            sock.settimeout(0.5)
            self._listen = sock
            if ready is not None:
                ready.set()
            while not self._stop.is_set():
                try:
                    conn, _addr = sock.accept()
                except TimeoutError:
                    continue
                except OSError:
                    if self._stop.is_set():
                        break
                    raise
                threading.Thread(target=self._handle, args=(conn,), daemon=True).start()
        except Exception as exc:
            self._boot_error = exc
            raise
        finally:
            os.umask(previous_umask)
            if ready is not None and not ready.is_set():
                ready.set()
            if sock is not None:
                try:
                    sock.close()
                except OSError:
                    pass
            self._listen = None

    def serve_in_thread(self) -> tuple[threading.Thread, threading.Event]:
        ready = threading.Event()
        thread = threading.Thread(target=self.serve_forever, kwargs={"ready": ready}, name="joehub-writer", daemon=True)
        thread.start()
        if not ready.wait(timeout=10):
            raise JoehubError("writer did not start listening")
        if self._boot_error is not None:
            raise JoehubError(f"writer failed to start: {self._boot_error}") from self._boot_error
        if not self.socket_path.exists():
            raise JoehubError("writer failed before listening")
        return thread, ready

    def close(self) -> None:
        self._stop.set()
        listen = self._listen
        if listen is not None:
            try:
                listen.close()
            except OSError:
                pass
        layer = self._layer
        self._layer = None
        if layer is not None:
            layer.close()

    def _chown_socket(self) -> None:
        if not self.socket_group:
            return
        import grp

        gid = grp.getgrnam(self.socket_group).gr_gid
        os.chown(self.socket_path, os.geteuid(), gid)

    def _handle(self, conn: socket.socket) -> None:
        try:
            peer = read_peer_cred(conn)
            principal = self._principal_for_uid(peer.uid)
            buffer = b""
            while not self._stop.is_set():
                chunk = conn.recv(65536)
                if not chunk:
                    break
                buffer += chunk
                if len(buffer) > _MAX_LINE:
                    conn.sendall(_dump({"id": None, "ok": False, "error": _error("JoehubError", "request is too large")}))
                    break
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    if not line.strip():
                        continue
                    conn.sendall(_dump(self._dispatch(principal, line)))
        except OSError:
            log.warning("writer connection closed", exc_info=True)
        finally:
            try:
                conn.close()
            except OSError:
                pass

    def _principal_for_uid(self, uid: int) -> Principal | None:
        access = self._access
        if access is None:
            return None
        name = access.name_for_uid(uid)
        if name is None:
            return None
        loaded = principal_by_name(self.settings, name)
        if loaded is None or not _kind_matches(loaded):
            return None
        return loaded

    def _dispatch(self, principal: Principal | None, line: bytes) -> dict:
        try:
            request = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {"id": None, "ok": False, "error": _error("JoehubError", "request is not json")}
        if not isinstance(request, dict):
            return {"id": None, "ok": False, "error": _error("JoehubError", "request is not an object")}
        request_id = request.get("id")
        present = _FORBIDDEN.intersection(request)
        if present:
            return {
                "id": request_id,
                "ok": False,
                "error": _error(
                    "JoehubError",
                    "credentials and principal names are not accepted on the writer socket",
                ),
            }
        if principal is None:
            return {
                "id": request_id,
                "ok": False,
                "error": _error("UnauthorizedError", "caller uid is not a mapped principal"),
            }
        method = request.get("method")
        try:
            if method == "write":
                result = self._write(principal, request)
                return {"id": request_id, "ok": True, "result": _result_payload(result)}
            if method == "delegate":
                delegation_id = self._delegate(principal, request)
                return {"id": request_id, "ok": True, "result": {"delegation_id": delegation_id}}
            if method == "revoke":
                self._revoke(principal, request)
                return {"id": request_id, "ok": True, "result": {}}
            return {"id": request_id, "ok": False, "error": _error("JoehubError", "unknown method")}
        except JoehubError as exc:
            return {"id": request_id, "ok": False, "error": _error(_type_name(exc), str(exc))}

    def _write(self, principal: Principal, request: dict) -> WriteResult:
        layer = self._layer
        if layer is None:
            raise JoehubError("writer is closed")
        table = request.get("table")
        operation = request.get("operation")
        payload = request.get("payload")
        key = request.get("idempotency_key")
        if not isinstance(table, str) or not isinstance(operation, str) or not isinstance(key, str):
            raise JoehubError("write requires table, operation, and idempotency_key")
        if not isinstance(payload, dict):
            raise JoehubError("write payload must be an object")
        with self._write_lock:
            return layer.write_as_principal(
                principal,
                table=table,
                operation=operation,
                payload=payload,
                idempotency_key=key,
            )

    def _delegate(self, principal: Principal, request: dict) -> str:
        layer = self._layer
        if layer is None:
            raise JoehubError("writer is closed")
        owner = request.get("delegate_owner")
        if not isinstance(owner, str):
            raise JoehubError("delegate requires delegate_owner")
        with self._write_lock:
            return layer.delegate_as_principal(principal, owner)

    def _revoke(self, principal: Principal, request: dict) -> None:
        layer = self._layer
        if layer is None:
            raise JoehubError("writer is closed")
        owner = request.get("delegate_owner")
        if not isinstance(owner, str):
            raise JoehubError("revoke requires delegate_owner")
        with self._write_lock:
            layer.revoke_as_principal(principal, owner)


def _kind_matches(principal: Principal) -> bool:
    if principal.name == HUMAN_NAME:
        return principal.kind == "human" and principal.owner_name is None
    if principal.name in OWNER_NAMES:
        return principal.kind == "owner" and principal.owner_name == principal.name
    return False


def _result_payload(result: WriteResult) -> dict:
    return {
        "row_id": result.row_id,
        "replayed": result.replayed,
        "status": result.status,
        "table": result.table,
        "operation": result.operation,
    }


def _type_name(exc: JoehubError) -> str:
    for cls, name in _ERROR_TYPES.items():
        if isinstance(exc, cls):
            return name
    return "JoehubError"


def _error(kind: str, message: str) -> dict:
    return {"type": kind, "message": message}


def _dump(payload: dict) -> bytes:
    return (json.dumps(payload, sort_keys=True) + "\n").encode("utf-8")


def main() -> None:
    settings = load_settings()
    access = os.environ.get("JOEHUB_ACCESS_MAP")
    socket_path = os.environ.get("JOEHUB_WRITER_SOCKET")
    if not access or not socket_path:
        raise SystemExit("JOEHUB_ACCESS_MAP and JOEHUB_WRITER_SOCKET are required")
    mode = int(os.environ.get("JOEHUB_WRITER_SOCKET_MODE", "660"), 8)
    group = os.environ.get("JOEHUB_WRITER_SOCKET_GROUP") or None
    server = WriterServer(settings, Path(access), Path(socket_path), socket_mode=mode, socket_group=group)
    server.serve_forever()


if __name__ == "__main__":
    main()
