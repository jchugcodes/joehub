"""Scan a Next.js build for database paths, age keys, and operator tokens."""

from __future__ import annotations

import sys
from pathlib import Path

MATERIAL = (
    "/home/box/joehub",
    "AGE-SECRET-KEY",
    "operator.token",
    "age-identity",
)
CLIENT_NAMES = (
    "JOEHUB_DB_PATH",
    "JOEHUB_OPERATOR_TOKEN",
    "JOEHUB_KEY_DIR",
    "JOEHUB_SESSION_SECRET",
    "JOEHUB_READ_CREDENTIAL",
    "NEXT_" + "PUBLIC_",
)


def scan(build: Path) -> list[str]:
    hits: list[str] = []
    static = build / "static"
    for path in build.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".js", ".json", ".html", ".txt", ".css", ".map"}:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for needle in MATERIAL:
            if needle in text:
                hits.append(f"{path}:{needle}")
        if static in path.parents or path == static:
            for needle in CLIENT_NAMES:
                if needle in text:
                    hits.append(f"{path}:{needle}")
    return hits


def main() -> int:
    build = Path(sys.argv[1] if len(sys.argv) > 1 else "web/.next")
    if not build.exists():
        print(f"missing build: {build}", file=sys.stderr)
        return 1
    hits = scan(build)
    if hits:
        print("\n".join(hits), file=sys.stderr)
        return 1
    print(f"scanned {build}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
