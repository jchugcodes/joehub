"""FastAPI app. Fixture routes are GET. Session routes, POST /api/tasks, and PATCH /api/tasks/{id} are the writes."""

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
    LoginResult,
    StatusCount,
    TransactionRow,
)
from joehub_api.ratelimit import RateLimiter
from joehub_api.read_source import ReadDenied, ReadSource, SyntheticReadSource
from joehub_api.sessions import COOKIE_NAME, SESSION_DAYS, AuthDisabled, AuthFailed, SessionStore
from joehub_api.settings import ApiSettings
from joehub_api.grocery import GroceryStore
from joehub_api.tasks import TaskStore

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
        description="Synthetic contract. Session posts, POST /api/tasks, PATCH /api/tasks/{id}, POST /api/grocery, and PATCH /api/grocery/{id} are the writes.",
        redirect_slashes=False,
    )
    app.state.settings = settings
    app.state.source = source or SyntheticReadSource(settings.read_credential)
    app.state.sessions = SessionStore(settings, clock or _utcnow)
    app.state.tasks = TaskStore()
    app.state.grocery = GroceryStore()
    app.state.login_limiter = RateLimiter(login_limit)
    app.state.api_limiter = RateLimiter(api_limit)

    @app.middleware("http")
    async def log_request(request: Request, call_next):
        ACCESS_LOG.info("%s %s", request.method, request.url.path)
        response = await call_next(request)
        response.headers["cache-control"] = "no-store"
        return response

    def client_ip(request: Request) -> str:
        # A client-supplied X-Forwarded-For is not a rate-limit key. Trust it
        # only when the TCP peer is in JOEHUB_TRUSTED_PROXIES.
        peer = request.client.host if request.client is not None and request.client.host else "unknown"
        if peer in request.app.state.settings.trusted_proxies:
            forwarded = request.headers.get("x-forwarded-for") or ""
            hop = forwarded.split(",")[0].strip()[:64]
            if hop:
                return hop
        return peer[:64]

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

    @app.get("/api/finance/accounts", response_model=list[AccountBalance])
    def finance_accounts(request: Request) -> list[dict]:
        return rows(request, "accounts")

    @app.get("/api/finance/transactions", response_model=list[TransactionRow])
    def finance_transactions(request: Request) -> list[dict]:
        return rows(request, "transactions")

    @app.get("/api/jobs/applications", response_model=list[ApplicationRow])
    def job_applications(request: Request) -> list[dict]:
        return rows(request, "applications")

    @app.get("/api/jobs/statuses", response_model=list[StatusCount])
    def job_statuses(request: Request) -> list[dict]:
        return rows(request, "statuses")

    @app.get("/api/journal/entries", response_model=list[JournalEntry])
    def journal_entries(request: Request) -> list[dict]:
        return rows(request, "entries")

    @app.get("/api/journal/events", response_model=list[EventRow])
    def journal_events(request: Request) -> list[dict]:
        return rows(request, "events")

    @app.get("/api/tasks")
    def list_tasks(request: Request, q: str = "") -> JSONResponse:
        require_session(request)
        if q.strip():
            return JSONResponse(request.app.state.tasks.search(q))
        return JSONResponse(request.app.state.tasks.list_unfinished())

    @app.post("/api/tasks")
    async def create_task(request: Request) -> JSONResponse:
        require_session(request)
        try:
            payload = await request.json()
        except Exception:
            return JSONResponse({"detail": "Task must be an object"}, status_code=400)
        header = request.headers.get("idempotency-key")
        idem = header.strip() if isinstance(header, str) else ""
        status, body = request.app.state.tasks.create(payload, idem or None)
        return JSONResponse(body, status_code=status)

    @app.get("/api/tasks/{id}")
    def get_task(id: str, request: Request) -> JSONResponse:
        require_session(request)
        status, body = request.app.state.tasks.get(id)
        return JSONResponse(body, status_code=status)

    @app.patch("/api/tasks/{id}")
    async def patch_task(id: str, request: Request) -> JSONResponse:
        require_session(request)
        try:
            payload = await request.json()
        except Exception:
            return JSONResponse({"detail": "Task must be an object"}, status_code=400)
        status, body = request.app.state.tasks.patch(id, payload)
        return JSONResponse(body, status_code=status)

    @app.delete("/api/tasks/{id}")
    def delete_task(id: str, request: Request) -> JSONResponse:
        require_session(request)
        status, body = request.app.state.tasks.delete(id)
        return JSONResponse(body, status_code=status)

    @app.post("/api/tasks/{id}/complete")
    def complete_task(id: str, request: Request) -> JSONResponse:
        require_session(request)
        status, body = request.app.state.tasks.complete(id)
        return JSONResponse(body, status_code=status)

    @app.post("/api/tasks/{id}/reopen")
    def reopen_task(id: str, request: Request) -> JSONResponse:
        require_session(request)
        status, body = request.app.state.tasks.reopen(id)
        return JSONResponse(body, status_code=status)

    @app.get("/api/grocery")
    def list_grocery(request: Request) -> JSONResponse:
        require_session(request)
        return JSONResponse(request.app.state.grocery.list_items())

    @app.post("/api/grocery")
    async def create_grocery(request: Request) -> JSONResponse:
        require_session(request)
        try:
            payload = await request.json()
        except Exception:
            return JSONResponse({"detail": "Item must be an object"}, status_code=400)
        header = request.headers.get("idempotency-key")
        idem = header.strip() if isinstance(header, str) else ""
        status, body = request.app.state.grocery.create(payload, idem or None)
        return JSONResponse(body, status_code=status)

    @app.get("/api/grocery/{id}")
    def get_grocery(id: str, request: Request) -> JSONResponse:
        require_session(request)
        status, body = request.app.state.grocery.get(id)
        return JSONResponse(body, status_code=status)

    @app.patch("/api/grocery/{id}")
    async def patch_grocery(id: str, request: Request) -> JSONResponse:
        require_session(request)
        try:
            payload = await request.json()
        except Exception:
            return JSONResponse({"detail": "Item must be an object"}, status_code=400)
        status, body = request.app.state.grocery.patch(id, payload)
        return JSONResponse(body, status_code=status)

    @app.delete("/api/grocery/{id}")
    def delete_grocery(id: str, request: Request) -> JSONResponse:
        require_session(request)
        status, body = request.app.state.grocery.delete(id)
        return JSONResponse(body, status_code=status)

    @app.post("/api/grocery/{id}/check")
    def check_grocery(id: str, request: Request) -> JSONResponse:
        require_session(request)
        status, body = request.app.state.grocery.check(id)
        return JSONResponse(body, status_code=status)

    @app.post("/api/grocery/{id}/uncheck")
    def uncheck_grocery(id: str, request: Request) -> JSONResponse:
        require_session(request)
        status, body = request.app.state.grocery.uncheck(id)
        return JSONResponse(body, status_code=status)

    @app.post("/api/session/login", response_model=LoginResult)
    async def session_login(request: Request, response: Response) -> LoginResult:
        try:
            payload = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="malformed auth") from None
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="malformed auth")
        username = payload.get("username")
        password = payload.get("password")
        label = payload.get("device_label")
        if not isinstance(username, str) or not isinstance(password, str):
            raise HTTPException(status_code=400, detail="malformed auth")
        if label is not None and not isinstance(label, str):
            raise HTTPException(status_code=400, detail="malformed auth")
        if not request.app.state.login_limiter.allow(client_ip(request)):
            raise HTTPException(status_code=429, detail="rate limit")
        try:
            device_id, cookie = request.app.state.sessions.login(username, password, label)
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

    @app.post("/api/session/logout")
    def session_logout(request: Request) -> JSONResponse:
        if not request.app.state.api_limiter.allow(client_ip(request)):
            raise HTTPException(status_code=429, detail="rate limit")
        cookie = request.cookies.get(COOKIE_NAME)
        request.app.state.sessions.logout(cookie)
        response = JSONResponse({"ok": True})
        response.delete_cookie(COOKIE_NAME, path="/", secure=True, httponly=True, samesite="lax")
        return response

    @app.get("/api/session/devices", response_model=list[Device])
    def session_devices(request: Request) -> list[dict]:
        require_session(request)
        return request.app.state.sessions.list_devices()

    @app.post("/api/session/devices/{device_id}/revoke")
    def session_revoke(device_id: str, request: Request) -> dict[str, str]:
        require_session(request)
        if not request.app.state.sessions.revoke(device_id):
            raise HTTPException(status_code=404, detail="unknown device")
        return {"device_id": device_id}

    return app
