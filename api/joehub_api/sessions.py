"""Server-side sessions. The cookie is an id; expiry does not move after login."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from joehub_api.settings import ApiSettings

COOKIE_NAME = "joehub_session"
SESSION_DAYS = 14
DEV_USERNAME = "synthetic"
DEV_PASSWORD = "synthetic"


class AuthDisabled(Exception):
    pass


class AuthFailed(Exception):
    pass


@dataclass
class SessionRecord:
    id: str
    device_id: str
    created_at: datetime
    expires_at: datetime
    revoked: bool = False


@dataclass
class DeviceRecord:
    id: str
    label: str
    created_at: datetime
    expires_at: datetime
    session_id: str
    revoked: bool = False


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _same(left: str, right: str) -> bool:
    if len(left) != len(right):
        return False
    return hmac.compare_digest(left, right)


def seal(secret: str, session_id: str) -> str:
    mac = hmac.new(secret.encode(), session_id.encode(), hashlib.sha256).hexdigest()
    return f"{session_id}.{mac}"


def open_cookie(secret: str, cookie: str) -> str | None:
    if not secret or "." not in cookie:
        return None
    session_id, mac = cookie.split(".", 1)
    if not session_id or not mac:
        return None
    expected = hmac.new(secret.encode(), session_id.encode(), hashlib.sha256).hexdigest()
    if len(mac) != len(expected) or not hmac.compare_digest(mac, expected):
        return None
    return session_id


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class SessionStore:
    def __init__(self, settings: ApiSettings, clock: Callable[[], datetime] | None = None):
        self.settings = settings
        self.clock = clock or _utcnow
        self.sessions: dict[str, SessionRecord] = {}
        self.devices: dict[str, DeviceRecord] = {}

    def login(self, username: str, password: str, label: str | None) -> tuple[str, str]:
        dev_login = self.settings.dev_auth or self.settings.fake_auth
        if self.settings.env == "production" or not dev_login:
            raise AuthDisabled()
        if not _same(username, DEV_USERNAME) or not _same(password, DEV_PASSWORD):
            raise AuthFailed()
        created = self.clock()
        session_id = secrets.token_hex(32)
        device_id = secrets.token_hex(16)
        expires = created + timedelta(days=SESSION_DAYS)
        cleaned = (label or "").strip()[:80] or "device"
        self.sessions[session_id] = SessionRecord(
            id=session_id,
            device_id=device_id,
            created_at=created,
            expires_at=expires,
        )
        self.devices[device_id] = DeviceRecord(
            id=device_id,
            label=cleaned,
            created_at=created,
            expires_at=expires,
            session_id=session_id,
        )
        return device_id, seal(self.settings.session_secret, session_id)

    def resolve(self, cookie: str | None) -> SessionRecord | None:
        if not cookie:
            return None
        session_id = open_cookie(self.settings.session_secret, cookie)
        if session_id is None:
            return None
        record = self.sessions.get(session_id)
        if record is None or record.revoked:
            return None
        if self.clock() >= record.expires_at:
            return None
        return record

    def logout(self, cookie: str | None) -> None:
        record = self.resolve(cookie)
        if record is None:
            return
        record.revoked = True
        device = self.devices.get(record.device_id)
        if device is not None:
            device.revoked = True

    def list_devices(self) -> list[dict[str, object]]:
        return [
            {
                "id": device.id,
                "label": device.label,
                "created_at": _iso(device.created_at),
                "expires_at": _iso(device.expires_at),
                "revoked": device.revoked,
            }
            for device in self.devices.values()
        ]

    def revoke(self, device_id: str) -> bool:
        device = self.devices.get(device_id)
        if device is None:
            return False
        device.revoked = True
        record = self.sessions.get(device.session_id)
        if record is not None:
            record.revoked = True
        return True
