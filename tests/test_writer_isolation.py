"""Principal isolation for the writer daemon.

Same-uid checks always run. The user-namespace test runs only when this
process can map several uids; otherwise it skips. Nothing here creates a real
host user or installs a unit.
"""

from __future__ import annotations

import os
import shutil
import socket
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from joehub.access import (
    AccessMap,
    assert_database_private,
    assert_distinct_principals,
    assert_socket_directory,
    read_peer_cred,
)
from joehub.errors import JoehubError, UnauthorizedError
from joehub.principals import HUMAN_NAME
from joehub.writer_client import WriterClient
from joehub.writer_service import WriterServer


def _map(uids: dict[str, int]) -> AccessMap:
    return AccessMap(uids)


def _write_map(path: Path, uids: dict[str, int]) -> Path:
    import json

    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    path.write_text(json.dumps({"principals": uids}), encoding="utf-8")
    os.chmod(path, 0o600)
    return path


def test_one_uid_cannot_be_two_principals():
    writer = os.geteuid()
    shared = writer + 1
    with pytest.raises(JoehubError, match="cannot tell those principals apart"):
        assert_distinct_principals(
            _map(
                {
                    HUMAN_NAME: shared,
                    "Ledger": shared,
                    "Scout": writer + 2,
                    "Cato": writer + 3,
                }
            ),
            writer,
        )


def test_a_principal_cannot_be_the_writer_uid():
    writer = os.geteuid()
    with pytest.raises(JoehubError, match="writer uid"):
        assert_distinct_principals(
            _map(
                {
                    HUMAN_NAME: writer + 1,
                    "Ledger": writer,
                    "Scout": writer + 2,
                    "Cato": writer + 3,
                }
            ),
            writer,
        )


def test_database_mode_and_owner_are_refused(settings):
    from joehub.write import WriteLayer

    WriteLayer(settings, recover=False).close()
    os.chmod(settings.db_path, 0o644)
    with pytest.raises(JoehubError, match="group or other"):
        assert_database_private(settings.db_path, os.geteuid())
    os.chmod(settings.db_path, 0o600)
    with pytest.raises(JoehubError, match="owned by"):
        assert_database_private(settings.db_path, os.geteuid() + 1)


def test_group_writable_socket_directory_is_refused(tmp_path):
    directory = tmp_path / "run"
    directory.mkdir()
    os.chmod(directory, 0o777)
    with pytest.raises(JoehubError, match="writable by group or other"):
        assert_socket_directory(directory, os.geteuid())


def test_peercred_of_this_process_is_one_uid(tmp_path):
    path = tmp_path / "peer.sock"
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(str(path))
    server.listen(2)
    first = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    second = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    first.connect(str(path))
    second.connect(str(path))
    left, _ = server.accept()
    right, _ = server.accept()
    try:
        assert read_peer_cred(left).uid == os.geteuid()
        assert read_peer_cred(right).uid == os.geteuid()
        assert read_peer_cred(left).uid == read_peer_cred(right).uid
    finally:
        for sock in (left, right, first, second, server):
            sock.close()


def test_daemon_on_the_shared_uid_is_not_a_principal_boundary(settings, tmp_path):
    """A daemon whose clients are the writer uid does not enforce ownership.

    The unmapped shared uid is rejected on the socket, and that same uid can
    still open the database file. That is not an end-to-end boundary.
    """
    writer = os.geteuid()
    access = _write_map(
        settings.key_dir / "access.json",
        {HUMAN_NAME: writer + 10, "Ledger": writer + 11, "Scout": writer + 12, "Cato": writer + 13},
    )
    socket_path = tmp_path / "run" / "writer.sock"
    server = WriterServer(settings, access, socket_path, socket_mode=0o666)
    server.serve_in_thread()
    try:
        with pytest.raises(UnauthorizedError, match="not a mapped principal"):
            WriterClient(socket_path).write(
                table="categories",
                operation="insert",
                payload={"name": "Shared", "kind": "expense"},
                idempotency_key="shared-uid",
            )
        conn = sqlite3.connect(settings.db_path)
        try:
            assert conn.execute("SELECT COUNT(*) FROM principals").fetchone()[0] == 4
        finally:
            conn.close()
    finally:
        server.close()


def test_user_namespace_enforces_distinct_uids(tmp_path):
    if shutil.which("newuidmap") is None or shutil.which("newgidmap") is None:
        pytest.skip("newuidmap is not installed; cannot simulate distinct uids")
    proc = subprocess.run(
        [sys.executable, "-m", "tests.userns_writer", str(tmp_path)],
        capture_output=True,
        text=True,
        cwd=Path(__file__).resolve().parents[1],
    )
    if proc.returncode == 77:
        pytest.skip(proc.stderr.strip() or proc.stdout.strip() or "user namespace unavailable")
    assert proc.returncode == 0, proc.stdout + "\n" + proc.stderr
