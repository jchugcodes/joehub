#!/usr/bin/env python3
"""Write a dashboard password hash outside the repo. The password is not printed."""

from __future__ import annotations

import getpass
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from joehub.auth import hash_password  # noqa: E402
from joehub.config import load_settings  # noqa: E402
from joehub.errors import JoehubError  # noqa: E402


def main() -> int:
    settings = load_settings()
    password = getpass.getpass("Dashboard password: ")
    confirm = getpass.getpass("Confirm password: ")
    if not password or password != confirm:
        print("passwords did not match", file=sys.stderr)
        return 2
    digest = hash_password(password)
    path = settings.auth_hash_file
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(path.parent, 0o700)
    path.write_text(digest + "\n", encoding="utf-8")
    os.chmod(path, 0o600)
    print(f"wrote password hash to {path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except JoehubError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
