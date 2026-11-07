"""Response shapes for the public read contract."""

from __future__ import annotations

from pydantic import BaseModel


class AccountBalance(BaseModel):
    id: str
    name: str
    account_type: str
    institution: str | None = None
    balance_cents: int


class TransactionRow(BaseModel):
    id: str
    date: str
    amount_cents: int
    payee: str | None = None
    memo: str | None = None
    account_name: str
    category_name: str | None = None


class ApplicationRow(BaseModel):
    id: str
    role_title: str
    status: str
    applied_on: str | None = None
    raw_company: str | None = None
    raw_contact: str | None = None
    raw_status: str | None = None
    raw_source: str | None = None
    notes: str | None = None
    company_id: str | None = None
    company_name: str | None = None


class StatusCount(BaseModel):
    status: str
    total: int


class JournalEntry(BaseModel):
    id: str
    entry_date: str
    title: str | None = None
    body: str
    mood: str | None = None


class EventRow(BaseModel):
    id: str
    title: str
    starts_at: str
    ends_at: str | None = None
    location: str | None = None
    notes: str | None = None


class Device(BaseModel):
    id: str
    label: str
    created_at: str
    expires_at: str
    revoked: bool


class LoginRequest(BaseModel):
    username: str
    password: str
    device_label: str | None = None


class LoginResult(BaseModel):
    device_id: str
