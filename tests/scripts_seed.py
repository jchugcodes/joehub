"""Import helper so tests can call the seed script without installing a scripts package."""

from __future__ import annotations

import importlib.util
from pathlib import Path

_PATH = Path(__file__).resolve().parents[1] / "scripts" / "seed_synthetic.py"
_SPEC = importlib.util.spec_from_file_location("seed_synthetic", _PATH)
assert _SPEC and _SPEC.loader
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)


def seed_main() -> int:
    return _MODULE.main()
