"""Runtime paths. Defaults live outside the repository and can be overridden with env vars."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from joehub.errors import ConfigError

DEFAULT_DB_PATH = Path("/home/box/joehub/data/joehub.db")
DEFAULT_EXPORT_DIR = Path("/home/box/joehub/exports")
DEFAULT_KEY_DIR = Path("/home/box/.config/joehub/keys")
DEFAULT_BIND_ADDRESS = "127.0.0.1"
DEFAULT_BIND_PORT = 8501

_PATH_ENV = {
    "db_path": "JOEHUB_DB_PATH",
    "export_dir": "JOEHUB_EXPORT_DIR",
    "key_dir": "JOEHUB_KEY_DIR",
}


@dataclass(frozen=True)
class Settings:
    db_path: Path
    export_dir: Path
    key_dir: Path
    lock_ttl_seconds: int
    max_retries: int
    retry_backoff_seconds: float
    export_remote: str | None
    bind_address: str
    bind_port: int
    auth_hash: str | None
    auth_hash_file: Path
    recovery_interval_seconds: float

    @property
    def age_identity_path(self) -> Path:
        return self.key_dir / "age-identity.txt"


def repo_roots() -> list[Path]:
    """Directories that look like this checkout. Data must not be written inside them."""
    roots: list[Path] = []
    starts = [Path.cwd().resolve(), Path(__file__).resolve()]
    for start in starts:
        for candidate in [start, *start.parents]:
            if (candidate / ".git").exists() and (candidate / "migrations").exists():
                if candidate not in roots:
                    roots.append(candidate)
                break
    return roots


def _path_contains(parent: Path, child: Path) -> bool:
    """True when the real path of child is parent or inside it.

    ``realpath`` resolves symlinks. A lexical check would miss a database path
    that sits outside the export directory and points at a file inside it.
    """
    parent_text = os.path.normcase(os.path.realpath(parent))
    child_text = os.path.normcase(os.path.realpath(child))
    if child_text == parent_text:
        return True
    prefix = parent_text if parent_text.endswith(os.sep) else parent_text + os.sep
    return child_text.startswith(prefix)


def assert_outside_repo(path: Path) -> None:
    resolved = path.resolve()
    for root in repo_roots():
        if resolved == root or resolved.is_relative_to(root):
            raise ConfigError(f"{resolved} is inside the repository; choose a path outside it")


def _env_path(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    path = Path(raw).expanduser() if raw else default
    if not path.is_absolute():
        path = Path.cwd() / path
    assert_outside_repo(path)
    return path


def _positive_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer") from exc
    if value <= 0:
        raise ConfigError(f"{name} must be > 0")
    return value


def load_settings() -> Settings:
    db_path = _env_path("JOEHUB_DB_PATH", DEFAULT_DB_PATH)
    export_dir = _env_path("JOEHUB_EXPORT_DIR", DEFAULT_EXPORT_DIR)
    key_dir = _env_path("JOEHUB_KEY_DIR", DEFAULT_KEY_DIR)
    if db_path == export_dir or key_dir == export_dir or key_dir == db_path:
        raise ConfigError("database, export, and key paths must be distinct")
    if _path_contains(export_dir, key_dir) or _path_contains(key_dir, export_dir):
        raise ConfigError("key directory and export directory must not contain each other")
    if _path_contains(export_dir, db_path):
        raise ConfigError("database path must not be inside the export directory")

    backoff_raw = os.environ.get("JOEHUB_RETRY_BACKOFF_SECONDS", "0.05")
    try:
        backoff = float(backoff_raw)
    except ValueError as exc:
        raise ConfigError("JOEHUB_RETRY_BACKOFF_SECONDS must be a number") from exc
    if backoff < 0:
        raise ConfigError("JOEHUB_RETRY_BACKOFF_SECONDS must be >= 0")

    interval_raw = os.environ.get("JOEHUB_RECOVERY_INTERVAL_SECONDS", "1")
    try:
        recovery_interval = float(interval_raw)
    except ValueError as exc:
        raise ConfigError("JOEHUB_RECOVERY_INTERVAL_SECONDS must be a number") from exc
    if recovery_interval < 0:
        raise ConfigError("JOEHUB_RECOVERY_INTERVAL_SECONDS must be >= 0")

    remote = os.environ.get("JOEHUB_EXPORT_REMOTE") or None
    if remote is not None:
        remote = remote.strip() or None

    bind = os.environ.get("JOEHUB_BIND_ADDRESS", DEFAULT_BIND_ADDRESS).strip()
    if not bind:
        raise ConfigError("JOEHUB_BIND_ADDRESS is empty")
    port = _positive_int("JOEHUB_BIND_PORT", DEFAULT_BIND_PORT)
    if port > 65535:
        raise ConfigError("JOEHUB_BIND_PORT is out of range")

    auth_hash = os.environ.get("JOEHUB_AUTH_HASH")
    if auth_hash is not None:
        auth_hash = auth_hash.strip() or None
    auth_file_raw = os.environ.get("JOEHUB_AUTH_HASH_FILE")
    if auth_file_raw:
        auth_hash_file = Path(auth_file_raw).expanduser()
        if not auth_hash_file.is_absolute():
            auth_hash_file = Path.cwd() / auth_hash_file
        assert_outside_repo(auth_hash_file)
        if _path_contains(export_dir, auth_hash_file):
            raise ConfigError("password hash file must not be inside the export directory")
    else:
        auth_hash_file = key_dir / "dashboard_auth_hash"
        if _path_contains(export_dir, auth_hash_file):
            raise ConfigError("password hash file must not be inside the export directory")

    return Settings(
        db_path=db_path,
        export_dir=export_dir,
        key_dir=key_dir,
        lock_ttl_seconds=_positive_int("JOEHUB_LOCK_TTL_SECONDS", 30),
        max_retries=_positive_int("JOEHUB_MAX_RETRIES", 8),
        retry_backoff_seconds=backoff,
        export_remote=remote,
        bind_address=bind,
        bind_port=port,
        auth_hash=auth_hash,
        auth_hash_file=auth_hash_file,
        recovery_interval_seconds=recovery_interval,
    )
