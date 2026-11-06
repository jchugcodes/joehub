"""Run the writer inside a user namespace with one uid per principal.

Invoked by tests/test_writer_isolation.py. Exit 77 when the namespace cannot
be created. This does not change the host's users.
"""

from __future__ import annotations

import ctypes
import json
import os
import shutil
import subprocess
import sys
import tempfile
import traceback
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

CLONE_NEWUSER = 0x10000000


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--client":
        client_main(sys.argv[2:])
        return
    root = Path(sys.argv[1])
    read_end, write_end = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(write_end)
        libc = ctypes.CDLL("libc.so.6", use_errno=True)
        if libc.unshare(CLONE_NEWUSER) != 0:
            sys.stderr.write(f"unshare failed: {ctypes.get_errno()}\n")
            os._exit(77)
        os.read(read_end, 1)
        try:
            scenario(root)
        except Exception:
            traceback.print_exc()
            os._exit(1)
        os._exit(0)
    os.close(read_end)
    try:
        subprocess.check_call(["newuidmap", str(pid), "0", str(os.getuid()), "1", "1", "100000", "10"])
        subprocess.check_call(["newgidmap", str(pid), "0", str(os.getgid()), "1", "1", "100000", "10"])
    except (OSError, subprocess.CalledProcessError) as exc:
        os.kill(pid, 9)
        sys.stderr.write(f"uid map failed: {exc}\n")
        sys.exit(77)
    os.write(write_end, b"x")
    os.close(write_end)
    _pid, status = os.waitpid(pid, 0)
    sys.exit(os.waitstatus_to_exitcode(status))


def scenario(_root: Path) -> None:
    os.umask(0o022)
    # pytest's tmp is mode 0700, so a client uid cannot traverse it to reach
    # the socket. This directory is 0755 under /tmp, which clients can walk.
    # The database and key directories underneath stay 0700.
    root = Path(tempfile.mkdtemp(prefix="joehub-ns-"))
    os.chmod(root, 0o755)
    data = root / "data"
    keys = root / "keys"
    exports = root / "exports"
    run = root / "run"
    queue = root / "queue"
    for directory, mode in ((data, 0o700), (keys, 0o700), (exports, 0o700), (run, 0o755), (queue, 0o755)):
        directory.mkdir(parents=True, mode=mode)
        os.chmod(directory, mode)
    os.environ["JOEHUB_DB_PATH"] = str(data / "joehub.db")
    os.environ["JOEHUB_EXPORT_DIR"] = str(exports)
    os.environ["JOEHUB_KEY_DIR"] = str(keys)
    os.environ["JOEHUB_RECOVERY_INTERVAL_SECONDS"] = "0"
    os.environ.pop("JOEHUB_EXPORT_REMOTE", None)

    from joehub.config import load_settings
    from joehub.db import connect
    from joehub.util import utcnow
    from joehub.writer_service import WriterServer

    access_path = keys / "access.json"
    access_path.write_text(
        json.dumps({"principals": {"operator": 1, "Ledger": 2, "Scout": 3, "Cato": 4}}),
        encoding="utf-8",
    )
    os.chmod(access_path, 0o600)
    settings = load_settings()
    socket_path = run / "writer.sock"
    server = WriterServer(settings, access_path, socket_path, socket_mode=0o666)
    server.serve_in_thread()
    try:
        ledger_insert = call(2, socket_path, settings.db_path, access_path, queue, {
            "method": "write",
            "table": "categories",
            "operation": "insert",
            "payload": {"name": "Ledger row", "kind": "expense"},
            "idempotency_key": "ledger-row",
        })
        assert ledger_insert["ok"] is True, ledger_insert
        assert ledger_insert["probes"]["db"] == 13
        assert ledger_insert["probes"]["access"] == 13

        scout_denied = call(3, socket_path, settings.db_path, access_path, queue, {
            "method": "write",
            "table": "categories",
            "operation": "insert",
            "payload": {"name": "Scout steal", "kind": "expense"},
            "idempotency_key": "scout-steal",
        })
        assert scout_denied["ok"] is False
        assert scout_denied["error_type"] == "UnauthorizedError"

        scout_ok = call(3, socket_path, settings.db_path, access_path, queue, {
            "method": "write",
            "table": "companies",
            "operation": "insert",
            "payload": {"name": "Example Scout Co"},
            "idempotency_key": "scout-co",
        })
        assert scout_ok["ok"] is True, scout_ok

        cato_ok = call(4, socket_path, settings.db_path, access_path, queue, {
            "method": "write",
            "table": "events",
            "operation": "insert",
            "payload": {"title": "Synthetic standup", "starts_at": utcnow()},
            "idempotency_key": "cato-event",
        })
        assert cato_ok["ok"] is True, cato_ok

        cato_denied = call(4, socket_path, settings.db_path, access_path, queue, {
            "method": "write",
            "table": "categories",
            "operation": "insert",
            "payload": {"name": "Cato steal", "kind": "income"},
            "idempotency_key": "cato-steal",
        })
        assert cato_denied["ok"] is False
        assert cato_denied["error_type"] == "UnauthorizedError"

        operator_early = call(1, socket_path, settings.db_path, access_path, queue, {
            "method": "write",
            "table": "categories",
            "operation": "insert",
            "payload": {"name": "Too soon", "kind": "expense"},
            "idempotency_key": "too-soon",
        })
        assert operator_early["ok"] is False
        assert operator_early["error_type"] == "UnauthorizedError"

        delegated = call(1, socket_path, settings.db_path, access_path, queue, {
            "method": "delegate",
            "delegate_owner": "Ledger",
        })
        assert delegated["ok"] is True, delegated

        operator_write = call(1, socket_path, settings.db_path, access_path, queue, {
            "method": "write",
            "table": "categories",
            "operation": "insert",
            "payload": {"name": "Operator row", "kind": "income"},
            "idempotency_key": "operator-row",
        })
        assert operator_write["ok"] is True, operator_write

        scout_delegate = call(3, socket_path, settings.db_path, access_path, queue, {
            "method": "delegate",
            "delegate_owner": "Ledger",
        })
        assert scout_delegate["ok"] is False
        assert scout_delegate["error_type"] == "UnauthorizedError"

        stranger = call(5, socket_path, settings.db_path, access_path, queue, {
            "method": "write",
            "table": "categories",
            "operation": "insert",
            "payload": {"name": "Stranger", "kind": "expense"},
            "idempotency_key": "stranger",
        })
        assert stranger["ok"] is False
        assert stranger["error_type"] == "UnauthorizedError"
        assert "not a mapped principal" in stranger["error"]

        forged = call(2, socket_path, settings.db_path, access_path, queue, {
            "method": "write",
            "table": "companies",
            "operation": "insert",
            "payload": {"name": "Forged"},
            "idempotency_key": "forged",
            "credential": "jht_stolen",
            "principal": "Scout",
        })
        assert forged["ok"] is False
        assert "not accepted" in forged["error"]

        conn = connect(settings.db_path)
        try:
            names = {row["name"] for row in conn.execute("SELECT name FROM categories")}
            companies = {row["name"] for row in conn.execute("SELECT name FROM companies")}
        finally:
            conn.close()
        assert names == {"Ledger row", "Operator row"}
        assert companies == {"Example Scout Co"}
        mode = (data / "joehub.db").stat().st_mode & 0o777
        assert mode == 0o600
    finally:
        server.close()
        shutil.rmtree(root, ignore_errors=True)


def call(uid: int, socket_path: Path, db_path: Path, access_path: Path, queue: Path, request: dict) -> dict:
    path = queue / f"{uuid.uuid4().hex}.json"
    path.write_text(json.dumps(request), encoding="utf-8")
    os.chmod(path, 0o644)
    os.chmod(queue, 0o755)
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "tests.userns_writer",
            "--client",
            str(uid),
            str(uid),
            str(socket_path),
            str(db_path),
            str(access_path),
            str(path),
        ],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout)
    return json.loads(proc.stdout)


def client_main(args: list[str]) -> None:
    uid_text, gid_text, socket_path, db_path, access_path, request_path = args
    os.setgid(int(gid_text))
    os.setuid(int(uid_text))
    probes: dict[str, object] = {}
    try:
        fd = os.open(db_path, os.O_RDWR)
        os.close(fd)
        probes["db"] = "opened"
    except OSError as exc:
        probes["db"] = exc.errno
    try:
        Path(access_path).read_text(encoding="utf-8")
        probes["access"] = "opened"
    except OSError as exc:
        probes["access"] = exc.errno
    request = json.loads(Path(request_path).read_text(encoding="utf-8"))
    sys.path.insert(0, str(ROOT / "src"))
    from joehub.errors import JoehubError
    from joehub.writer_client import WriterClient

    try:
        response = WriterClient(Path(socket_path)).request(request)
    except JoehubError as exc:
        print(json.dumps({"ok": False, "probes": probes, "error_type": type(exc).__name__, "error": str(exc)}))
        return
    print(json.dumps({"ok": True, "probes": probes, "response": response}))


if __name__ == "__main__":
    main()
