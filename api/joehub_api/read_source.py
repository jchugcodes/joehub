"""Read sources. The default is fixtures. Live rows come only from an injected connection."""

from __future__ import annotations

import hmac
from typing import Protocol

from joehub_api.synthetic import load_fixtures


class ReadDenied(Exception):
    pass


def _same(left: object, right: str) -> bool:
    if not isinstance(left, str):
        return False
    try:
        left_bytes = left.encode("utf-8")
        right_bytes = right.encode("utf-8")
    except UnicodeError:
        return False
    return hmac.compare_digest(left_bytes, right_bytes)


class ReadSource(Protocol):
    def accounts(self, credential: str) -> list[dict]: ...

    def transactions(self, credential: str) -> list[dict]: ...

    def applications(self, credential: str) -> list[dict]: ...

    def statuses(self, credential: str) -> list[dict]: ...

    def entries(self, credential: str) -> list[dict]: ...

    def events(self, credential: str) -> list[dict]: ...


class SyntheticReadSource:
    def __init__(self, expected_credential: str, data: dict[str, list[dict]] | None = None):
        self.expected_credential = expected_credential
        self.data = data if data is not None else load_fixtures()

    def _allow(self, credential: str) -> None:
        if not _same(credential, self.expected_credential):
            raise ReadDenied()

    def accounts(self, credential: str) -> list[dict]:
        self._allow(credential)
        return self.data["accounts"]

    def transactions(self, credential: str) -> list[dict]:
        self._allow(credential)
        return self.data["transactions"]

    def applications(self, credential: str) -> list[dict]:
        self._allow(credential)
        return self.data["applications"]

    def statuses(self, credential: str) -> list[dict]:
        self._allow(credential)
        return self.data["statuses"]

    def entries(self, credential: str) -> list[dict]:
        self._allow(credential)
        return self.data["entries"]

    def events(self, credential: str) -> list[dict]:
        self._allow(credential)
        return self.data["events"]


class QueryReadSource:
    """Fixed joehub read functions. The caller supplies the connection.

    This class does not open a database file and does not read process settings.
    """

    def __init__(self, conn: object, expected_credential: str):
        self.conn = conn
        self.expected_credential = expected_credential

    def _allow(self, credential: str) -> None:
        if not _same(credential, self.expected_credential):
            raise ReadDenied()

    def accounts(self, credential: str) -> list[dict]:
        self._allow(credential)
        from joehub.queries import account_balances

        return account_balances(self.conn)

    def transactions(self, credential: str) -> list[dict]:
        self._allow(credential)
        from joehub.queries import recent_transactions

        return recent_transactions(self.conn)

    def applications(self, credential: str) -> list[dict]:
        self._allow(credential)
        from joehub.queries import applications

        return applications(self.conn)

    def statuses(self, credential: str) -> list[dict]:
        self._allow(credential)
        from joehub.queries import status_counts

        return status_counts(self.conn)

    def entries(self, credential: str) -> list[dict]:
        self._allow(credential)
        from joehub.queries import journal_entries

        return journal_entries(self.conn)

    def events(self, credential: str) -> list[dict]:
        self._allow(credential)
        from joehub.queries import events

        return events(self.conn)
