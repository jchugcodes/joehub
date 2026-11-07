#!/usr/bin/env python3
"""Run the isolated writer. The process uid must be the writer user.

Requires JOEHUB_ACCESS_MAP and JOEHUB_WRITER_SOCKET. Does not create users,
change ownership of an existing installation, or install a systemd unit.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from joehub.writer_service import main  # noqa: E402


if __name__ == "__main__":
    main()
