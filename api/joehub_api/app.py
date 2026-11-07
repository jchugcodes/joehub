"""FastAPI app. Domain routes are GET. Session routes are the only writes."""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from joehub_api.models import (
    AccountBalance,
    ApplicationRow,
    Device,
    EventRow,
    JournalEntry,
    LoginRequest,
    LoginResult,
    StatusCount,
    TransactionRow,
)
from joehub_api.ratelimit import RateLimiter
from joehub_api.read_source import ReadDenied, ReadSource, SyntheticReadSource
from joehub_api.sessions import COOKIE_NAME, SESSION_DAYS, AuthDisabled, AuthFailed, SessionStore
from joehub_api.settings import ApiSettings

ACCESS_LOG = logging.getLogger("joehub_api.access")
COOKIE_MAX_AGE = SESSION_DAYS * 24 * 60 * 60


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def create_app(
    settings: ApiSettings | None = None,
    environ: Mapping[str, str] | None = None,
    source: ReadSource | None = None,
    clock: Callable[[], datetime] | None = None,
    login_limit: int = 5,
    api_limit: int = 60,
) -> FastAPI:
    if settings is None:
        settings = ApiSettings.from_env()
        env: Mapping[str, str] = environ if environ is not None else __import__("os").environ
    else:
        env = {} if environ is None else environ
    settings.check(env)
    app = FastAPI(
        title="joehub public read API",
        version="0.1.0",
        description="Read-only synthetic contract. Session posts are the only writes.",
        redirect_slashes=False,
    )
    app.state.settings = settings
    app.state.source = source or SyntheticReadSource(settings.read_credential)
    app.state.sessions = SessionStore(settings, clock or _utcnow)
    app.state.login_limiter = RateLimiter(login_limit)
    app.state.api_limiter = RateLimiter(api_limit)

    @app.middleware("http")
    async def log_request(request: Request, call_next):
        ACCESS_LOG.info("%s %s", request.method, request.url.path)
        response = await call_next(request)
        response.headers["cache-control"] = "no-store"
        return response

    def client_ip(request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()[:64]
        if request.client is None:
            return "unknown"
        return request.client.host

    def require_session(request: Request) -> None:
        if not request.app.state.api_limiter.allow(client_ip(request)):
            raise HTTPException(status_code=429, detail="rate limit")
        if request.app.state.sessions.resolve(request.cookies.get(COOKIE_NAME)) is None:
            raise HTTPException(status_code=401, detail="authentication required")

    def rows(request: Request, name: str) -> list[dict]:
        require_session(request)
        try:
            return getattr(request.app.state.source, name)(request.app.state.settings.read_credential)
        except ReadDenied:
            raise HTTPException(status_code=503, detail="read credential rejected") from None

    @app.get("/finance/accounts", response_model=list[AccountBalance])
    def finance_accounts(request: Request) -> list[dict]:
        return rows(request, "accounts")

    @app.get("/finance/transactions", response_model=list[TransactionRow])
    def finance_transactions(request: Request) -> list[dict]:
        return rows(request, "transactions")

    @app.get("/jobs/applications", response_model=list[ApplicationRow])
    def job_applications(request: Request) -> list[dict]:
        return rows(request, "applications")

    @app.get("/jobs/statuses", response_model=list[StatusCount])
    def job_statuses(request: Request) -> list[dict]:
        return rows(request, "statuses")

    @app.get("/journal/entries", response_model=list[JournalEntry])
    def journal_entries(request: Request) -> list[dict]:
        return rows(request, "entries")

    @app.get("/journal/events", response_model=list[EventRow])
    def journal_events(request: Request) -> list[dict]:
        return rows(request, "events")

    @app.post("/session/login", response_model=LoginResult)
    def session_login(body: LoginRequest, request: Request, response: Response) -> LoginResult:
        if not request.app.state.login_limiter.allow(client_ip(request)):
            raise HTTPException(status_code=429, detail="rate limit")
        try:
            device_id, cookie = request.app.state.sessions.login(
                body.username, body.password, body.device_label
            )
        except AuthDisabled:
            raise HTTPException(status_code=404, detail="dev auth is disabled") from None
        except AuthFailed:
            raise HTTPException(status_code=401, detail="authentication required") from None
        response.set_cookie(
            COOKIE_NAME,
            cookie,
            httponly=True,
            secure=True,
            samesite="lax",
            path="/",
            max_age=COOKIE_MAX_AGE,
        )
        return LoginResult(device_id=device_id)

    @app.post("/session/logout")
    def session_logout(request: Request) -> JSONResponse:
        if not request.app.state.api_limiter.allow(client_ip(request)):
            raise HTTPException(status_code=429, detail="rate limit")
        cookie = request.cookies.get(COOKIE_NAME)
        request.app.state.sessions.logout(cookie)
        response = JSONResponse({"ok": True})
        response.delete_cookie(COOKIE_NAME, path="/", secure=True, httponly=True, samesite="lax")
        return response

    @app.get("/session/devices", response_model=list[Device])
    def session_devices(request: Request) -> list[dict]:
        require_session(request)
        return request.app.state.sessions.list_devices()

    @app.post("/session/devices/{device_id}/revoke")
    def session_revoke(device_id: str, request: Request) -> dict[str, str]:
        require_session(request)
        if not request.app.state.sessions.revoke(device_id):
            raise HTTPException(status_code=404, detail="unknown device")
        return {"device_id": device_id}

    return app
