"""In-process rate limit. Not shared across hosts and not durable storage."""

from __future__ import annotations

import time
from collections.abc import Callable


class RateLimiter:
    def __init__(self, limit: int, window_seconds: float = 60.0, clock: Callable[[], float] | None = None):
        self.limit = limit
        self.window = window_seconds
        self.clock = clock or time.monotonic
        self.hits: dict[str, list[float]] = {}

    def allow(self, key: str) -> bool:
        now = self.clock()
        bucket = [stamp for stamp in self.hits.get(key, []) if now - stamp < self.window]
        if len(bucket) >= self.limit:
            self.hits[key] = bucket
            return False
        bucket.append(now)
        self.hits[key] = bucket
        return True
