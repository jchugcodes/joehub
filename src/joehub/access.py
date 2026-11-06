"""Caller identity for the isolated writer.

A bearer token is not an identity when every client can read it. The writer
accepts a Unix-socket peer only when the kernel reports a uid that the access
map assigns to exactly one principal, and that uid is not the writer's own.
"""

from __future__ import annotations

import json
import os
import socket
import struct
from dataclasses import dataclass
from pathlib import Path

from joehub.errors import JoehubError
from joehub.principals import HUMAN_NAME, OWNER_NAMES

PRINCIPAL_NAMES = (HUMAN_NAME, *OWNER_NAMES)


@dataclass(frozen=True)
class PeerCred:
    pid: int
    uid: int
    gid: int


@dataclass(frozen=True)
class AccessMap:
    """Name to uid. Kinds are not taken from this file."""

    uids: dict[str, int]

    def name_for_uid(self, uid: int) -> str | None:
        matches = [name for name, mapped in self.uids.items() if mapped == uid]
        if len(matches) != 1:
            return None
        return matches[0]


def read_peer_cred(sock: socket.socket) -> PeerCred:
    """Return the kernel identity of the process on the other end of ``sock``."""
    if not hasattr(socket, "SO_PEERCRED"):
        raise JoehubError("this platform has no SO_PEERCRED; peer identity is unavailable")
    size = struct.calcsize("3i")
    try:
        raw = sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, size)
    except OSError as exc:
        raise JoehubError("could not read the caller's kernel identity") from exc
    pid, uid, gid = struct.unpack("3i", raw[:size])
    return PeerCred(pid=pid, uid=uid, gid=gid)


def load_access_map(path: Path) -> AccessMap:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise JoehubError("access map is unreadable") from exc
    if not isinstance(data, dict) or not isinstance(data.get("principals"), dict):
        raise JoehubError("access map must contain a principals object")
    raw = data["principals"]
    if set(raw) != set(PRINCIPAL_NAMES):
        raise JoehubError("access map must list operator, Ledger, Scout, and Cato, and no other principal")
    uids: dict[str, int] = {}
    for name in PRINCIPAL_NAMES:
        value = raw[name]
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise JoehubError(f"{name} uid is not a uid")
        uids[name] = value
    return AccessMap(uids)


def assert_distinct_principals(access: AccessMap, writer_uid: int) -> None:
    """Refuse a map that cannot tell the clients from each other or from the writer."""
    seen: dict[int, str] = {}
    for name, uid in access.uids.items():
        if uid == writer_uid:
            raise JoehubError(
                f"{name} is mapped to the writer uid {writer_uid}; "
                "a client that shares the writer uid can open the database itself"
            )
        previous = seen.get(uid)
        if previous is not None:
            raise JoehubError(
                f"uid {uid} is assigned to both {previous} and {name}; "
                "SO_PEERCRED cannot tell those principals apart"
            )
        seen[uid] = name


def assert_private_file(path: Path, owner_uid: int) -> None:
    _assert_owned(path, owner_uid, writable_bits=0o077, what="readable or writable by group or other")


def assert_private_directory(path: Path, owner_uid: int) -> None:
    """The database directory must not be traversable by clients."""
    _assert_owned(path, owner_uid, writable_bits=0o077, what="accessible to group or other")


def assert_socket_directory(path: Path, owner_uid: int) -> None:
    """Clients may traverse the socket directory. They must not be able to replace the socket."""
    _assert_owned(path, owner_uid, writable_bits=0o022, what="writable by group or other")


def assert_database_private(db_path: Path, owner_uid: int) -> None:
    if not db_path.is_file():
        raise JoehubError("database file is missing")
    assert_private_directory(db_path.parent, owner_uid)
    assert_private_file(db_path, owner_uid)
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(db_path) + suffix)
        if sidecar.exists():
            assert_private_file(sidecar, owner_uid)


def harden_database(db_path: Path) -> None:
    """Make the database and its directory owner-only. The caller must be the owner."""
    db_path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(db_path.parent, 0o700)
    if db_path.exists():
        os.chmod(db_path, 0o600)
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(db_path) + suffix)
        if sidecar.exists():
            os.chmod(sidecar, 0o600)


def _assert_owned(path: Path, owner_uid: int, *, writable_bits: int, what: str) -> None:
    try:
        st = path.stat()
    except OSError as exc:
        raise JoehubError(f"{path} is not accessible to the writer") from exc
    if st.st_uid != owner_uid:
        raise JoehubError(f"{path} is owned by uid {st.st_uid}, not the writer uid {owner_uid}")
    if st.st_mode & writable_bits:
        raise JoehubError(f"{path} is {what}")
