"""Fail the build when a public browser env name looks like a secret."""

from __future__ import annotations

from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
PREFIX = "NEXT_" + "PUBLIC_"
WORDS = ("SECRET", "TOKEN", "PASSWORD", "CREDENTIAL", "AGE", "OPERATOR", "DB_PATH", "KEY")
SKIP_DIRS = {".git", "node_modules", ".next", ".pytest_cache", ".venv", "venv", "__pycache__"}
MATERIAL = (
    "/home/box/joehub",
    "AGE-SECRET-KEY",
    "operator.token",
    "age-identity",
)


def _files() -> list[Path]:
    found: list[Path] = []
    for path in REPO.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() not in {".py", ".ts", ".tsx", ".mjs", ".js", ".json", ".md", ".toml", ".yml", ".css"}:
            continue
        found.append(path)
    return found


def test_public_env_names_are_not_secrets() -> None:
    import re

    pattern = re.compile(PREFIX + r"[A-Z0-9_]*(" + "|".join(WORDS) + r")", re.IGNORECASE)
    hits: list[str] = []
    for path in _files():
        if path.name == "test_web_public_env.py":
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if pattern.search(text):
            hits.append(str(path.relative_to(REPO)))
    assert hits == []


def test_web_and_contract_sources_omit_secret_material() -> None:
    hits: list[str] = []
    roots = [REPO / "web", REPO / "contract"]
    for root in roots:
        for path in root.rglob("*"):
            if not path.is_file() or any(part in SKIP_DIRS for part in path.parts):
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            for needle in MATERIAL:
                if needle in text:
                    hits.append(f"{path.relative_to(REPO)}:{needle}")
    assert hits == []


def test_built_web_output_omits_secret_material() -> None:
    import sys

    build = REPO / "web" / ".next"
    if not build.exists():
        pytest.skip("web build is not present")
    sys.path.insert(0, str(REPO))
    from scripts.scan_web_build import scan

    assert scan(build) == []
