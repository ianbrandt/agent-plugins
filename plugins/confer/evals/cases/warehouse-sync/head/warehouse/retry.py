"""Retrying feed requests that fail for a reason that may pass."""

from __future__ import annotations

import functools
import logging
import random
import time
from dataclasses import dataclass
from typing import Callable, TypeVar

from .feed import FeedUnavailable

log = logging.getLogger(__name__)

T = TypeVar("T")

TRANSIENT_ERRORS = (FeedUnavailable, ConnectionError, TimeoutError)


@dataclass(frozen=True)
class RetryPolicy:
    """How often to retry, and how long to wait in between. Delays are in seconds.

    The delay after the nth failed attempt is base_delay * multiplier ** (n - 1), capped at
    max_delay, then moved by up to `jitter` (a fraction of it) either way, so that several
    clients that failed together do not retry together.
    """

    attempts: int = 5
    base_delay: float = 0.5
    max_delay: float = 30.0
    multiplier: float = 2.0
    jitter: float = 0.1

    def __post_init__(self):
        if self.attempts < 1:
            raise ValueError(f"attempts must be at least 1: {self.attempts}")
        if self.base_delay < 0:
            raise ValueError(f"base_delay cannot be negative: {self.base_delay}")
        if self.max_delay < self.base_delay:
            raise ValueError(f"max_delay {self.max_delay} is shorter than base_delay {self.base_delay}")
        if self.multiplier < 1:
            raise ValueError(f"multiplier must be at least 1: {self.multiplier}")
        if not 0 <= self.jitter < 1:
            raise ValueError(f"jitter must be at least 0 and below 1: {self.jitter}")

    def delay(self, attempt: int, rand: Callable[[], float] = random.random) -> float:
        """Seconds to wait after failed attempt number `attempt`, counting from 1."""
        if attempt < 1:
            raise ValueError(f"attempts are counted from 1: {attempt}")
        raw = self.base_delay * self.multiplier ** (attempt - 1)
        capped = min(raw, self.max_delay)
        return capped * (1 + self.jitter * (2 * rand() - 1))

    def schedule(self) -> list[float]:
        """The delays between attempts without jitter, for logs and the status report."""
        return [min(self.base_delay * self.multiplier ** n, self.max_delay) for n in range(self.attempts - 1)]


class RetriesExhausted(Exception):
    """Every attempt failed, or waiting for the next one would pass the deadline."""

    def __init__(self, attempts: int, last_error: BaseException):
        super().__init__(f"gave up after {attempts} attempts: {last_error}")
        self.attempts = attempts
        self.last_error = last_error


def is_transient(exc: BaseException) -> bool:
    """Whether a failed call is worth trying again."""
    return isinstance(exc, TRANSIENT_ERRORS)


@dataclass
class RetryStats:
    """Counts kept by a Retrier over its life."""

    calls: int = 0
    retries: int = 0
    gave_up: int = 0
    waited: float = 0.0

    def describe(self) -> str:
        return f"{self.calls} calls, {self.retries} retries, {self.gave_up} given up, {self.waited:.1f}s waiting"


def retrying(policy: RetryPolicy, **options) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Decorate a function so that each call to it goes through a Retrier with `policy`.

    The Retrier is available as the wrapper's `retrier` attribute, for its stats.
    """

    def decorate(fn: Callable[..., T]) -> Callable[..., T]:
        retrier = Retrier(policy, **options)

        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            return retrier.call(fn, *args, **kwargs)

        wrapper.retrier = retrier  # type: ignore[attr-defined]
        return wrapper

    return decorate


class Retrier:
    """Calls a function, and calls it again after a transient error, as the policy allows.

    `deadline`, in seconds, limits the time one call may take, waits included. Without it, only
    the number of attempts is limited.
    """

    def __init__(
        self,
        policy: RetryPolicy,
        *,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        rand: Callable[[], float] = random.random,
        deadline: float | None = None,
    ):
        if deadline is not None and deadline <= 0:
            raise ValueError(f"deadline must be positive: {deadline}")
        self.policy = policy
        self.deadline = deadline
        self.stats = RetryStats()
        self._sleep = sleep
        self._clock = clock
        self._rand = rand

    def call(self, fn: Callable[..., T], *args, **kwargs) -> T:
        self.stats.calls += 1
        started = self._clock()
        attempt = 0
        while True:
            attempt += 1
            try:
                return fn(*args, **kwargs)
            except Exception as exc:
                if not is_transient(exc):
                    raise
                if attempt >= self.policy.attempts:
                    self.stats.gave_up += 1
                    raise RetriesExhausted(attempt, exc) from exc
                wait = self.wait_after(attempt, exc)
                if self.deadline is not None and self._clock() - started + wait > self.deadline:
                    self.stats.gave_up += 1
                    raise RetriesExhausted(attempt, exc) from exc
                log.warning("attempt %d failed (%s); retrying in %.1fs", attempt, exc, wait)
                self.stats.retries += 1
                self.stats.waited += wait
                self._sleep(wait)

    def wait_after(self, attempt: int, exc: BaseException) -> float:
        """Seconds to wait after a failed attempt: the policy's delay, or longer if the server asked."""
        wait = self.policy.delay(attempt, self._rand)
        retry_after = getattr(exc, "retry_after_ms", None)
        if retry_after is not None:
            wait = max(wait, retry_after)
        return wait
