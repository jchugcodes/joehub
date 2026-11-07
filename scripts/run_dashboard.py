#!/usr/bin/env python3
"""Start the Streamlit dashboard on localhost."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

from joehub.config import load_settings  # noqa: E402


def main() -> int:
    settings = load_settings()
    app = SRC / "joehub" / "dashboard" / "streamlit_app.py"
    env = os.environ.copy()
    previous = env.get("PYTHONPATH")
    env["PYTHONPATH"] = str(SRC) if not previous else str(SRC) + os.pathsep + previous
    os.chdir(ROOT)
    os.execvpe(
        sys.executable,
        [
            sys.executable,
            "-m",
            "streamlit",
            "run",
            str(app),
            "--server.address",
            settings.bind_address,
            "--server.port",
            str(settings.bind_port),
            "--server.headless",
            "true",
            "--browser.gatherUsageStats",
            "false",
        ],
        env,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
