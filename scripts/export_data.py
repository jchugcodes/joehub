#!/usr/bin/env python3
"""Encrypt every table to the export directory. Push only when the GitHub repo is PRIVATE."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from joehub.backup import export_all  # noqa: E402
from joehub.config import load_settings  # noqa: E402
from joehub.errors import JoehubError  # noqa: E402
from joehub.principals import operator_token  # noqa: E402
from joehub.write import WriteLayer  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Export encrypted joehub tables")
    parser.add_argument("--push", action="store_true", help="Push to JOEHUB_EXPORT_REMOTE or --remote")
    parser.add_argument("--remote", default=None, help="Git remote URL. Overrides JOEHUB_EXPORT_REMOTE.")
    args = parser.parse_args()
    settings = load_settings()
    # Explicit audited delegation. The operator token is not Cato by itself.
    operator = operator_token(settings)
    WriteLayer(settings).delegate(operator, "Cato")
    remote = args.remote if args.remote is not None else (settings.export_remote if args.push else None)
    if args.push and not remote:
        print("Set --remote or JOEHUB_EXPORT_REMOTE before pushing.", file=sys.stderr)
        return 2
    summary = export_all(settings, remote=remote)
    print(f"exported {len(summary.files)} files to {settings.export_dir}")
    if summary.push_status:
        print(f"push status: {summary.push_status}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except JoehubError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
