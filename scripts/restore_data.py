#!/usr/bin/env python3
"""Rebuild a database from age-encrypted CSV exports."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from joehub.backup import restore_all  # noqa: E402
from joehub.config import load_settings  # noqa: E402
from joehub.errors import JoehubError  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Restore joehub from encrypted exports")
    parser.add_argument("--force", action="store_true", help="Replace an existing database file")
    args = parser.parse_args()
    settings = load_settings()
    restore_all(settings, force=args.force)
    print(f"restored {settings.db_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except JoehubError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
