from __future__ import annotations

from pathlib import Path

import pytest

from joehub.config import load_settings
from joehub.write import WriteLayer


@pytest.fixture(autouse=True)
def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("JOEHUB_DB_PATH", str(tmp_path / "joehub.db"))
    monkeypatch.setenv("JOEHUB_EXPORT_DIR", str(tmp_path / "exports"))
    monkeypatch.setenv("JOEHUB_KEY_DIR", str(tmp_path / "keys"))
    monkeypatch.setenv("JOEHUB_LOCK_TTL_SECONDS", "5")
    monkeypatch.setenv("JOEHUB_MAX_RETRIES", "6")
    monkeypatch.setenv("JOEHUB_RETRY_BACKOFF_SECONDS", "0.01")
    monkeypatch.delenv("JOEHUB_AUTH_HASH", raising=False)
    monkeypatch.delenv("JOEHUB_AUTH_HASH_FILE", raising=False)
    monkeypatch.delenv("JOEHUB_EXPORT_REMOTE", raising=False)
    return tmp_path


@pytest.fixture
def settings(isolated_env: Path):
    return load_settings()


@pytest.fixture
def writer(settings) -> WriteLayer:
    return WriteLayer(settings)
