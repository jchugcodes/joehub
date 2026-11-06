"""Client for the isolated writer.

The caller does not send a credential. The writer reads the process uid from
the kernel. This module cannot make one uid into two principals.
"""

from __future__ import annotations

import json
import socket
import uuid
from pathlib import Path

from joehub.errors import JoehubError, PermanentWriteError, TransientWriteError, UnauthorizedError, ValidationError
from joehub.write import WriteResult

_ERRORS = {
    "UnauthorizedError": UnauthorizedError,
    "ValidationError": ValidationError,
    "PermanentWriteError": PermanentWriteError,
    "TransientWriteError": TransientWriteError,
    "JoehubError": JoehubError,
}


class WriterClient:
    def __init__(self, socket_path: Path):
        self.socket_path = socket_path

    def write(self, *, table: str, operation: str, payload: dict, idempotency_key: str) -> WriteResult:
        response = self.request(
            {
                "method": "write",
                "table": table,
                "operation": operation,
                "payload": payload,
                "idempotency_key": idempotency_key,
            }
        )
        result = response["result"]
        return WriteResult(
            row_id=result["row_id"],
            replayed=bool(result["replayed"]),
            status=str(result["status"]),
            table=str(result["table"]),
            operation=str(result["operation"]),
        )

    def delegate(self, owner_name: str) -> str:
        response = self.request({"method": "delegate", "delegate_owner": owner_name})
        return str(response["result"]["delegation_id"])

    def revoke(self, owner_name: str) -> None:
        self.request({"method": "revoke", "delegate_owner": owner_name})

    def request(self, payload: dict) -> dict:
        body = dict(payload)
        body.setdefault("id", uuid.uuid4().hex)
        raw = self._roundtrip(body)
        if not isinstance(raw, dict):
            raise JoehubError("writer returned an unreadable response")
        if raw.get("ok") is True:
            return raw
        error = raw.get("error") if isinstance(raw.get("error"), dict) else {}
        kind = str(error.get("type") or "JoehubError")
        message = str(error.get("message") or "writer request failed")
        exc_type = _ERRORS.get(kind, JoehubError)
        raise exc_type(message)

    def _roundtrip(self, payload: dict) -> dict:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            sock.connect(str(self.socket_path))
            sock.sendall((json.dumps(payload) + "\n").encode("utf-8"))
            buffer = b""
            while b"\n" not in buffer:
                chunk = sock.recv(65536)
                if not chunk:
                    raise JoehubError("writer closed the connection")
                buffer += chunk
                if len(buffer) > 1024 * 1024:
                    raise JoehubError("writer response is too large")
        finally:
            sock.close()
        line = buffer.split(b"\n", 1)[0]
        try:
            return json.loads(line.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise JoehubError("writer returned an unreadable response") from exc
