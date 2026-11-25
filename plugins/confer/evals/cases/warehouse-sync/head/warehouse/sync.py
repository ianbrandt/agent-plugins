"""Incremental sync of movements from a warehouse feed into the store."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Callable, Protocol

from .batching import batched
from .checkpoint import CheckpointStore
from .config import SyncConfig
from .deadletter import DeadLetterFile
from .feed import FileFeed, HttpFeed, Page
from .retry import RetriesExhausted, Retrier, RetryPolicy
from .store import Store

log = logging.getLogger(__name__)


class Feed(Protocol):
    name: str

    def fetch(self, after: int, limit: int) -> Page: ...


class Stopper(Protocol):
    def is_set(self) -> bool: ...

    def wait(self, timeout: float) -> bool: ...


def feed_from_config(config: SyncConfig) -> Feed:
    if config.feed_url is not None:
        return HttpFeed(config.feed_url, config.feed_name)
    return FileFeed(config.feed_path, config.feed_name)


@dataclass
class SyncResult:
    """What one sync run did."""

    checkpoint: int = 0
    pages: int = 0
    fetched: int = 0
    applied: int = 0
    rejected: int = 0

    @property
    def duplicates(self) -> int:
        """Movements fetched that the store already had."""
        return self.fetched - self.applied

    def describe(self) -> str:
        return (
            f"fetched {self.fetched} movements in {self.pages} pages, applied {self.applied}, "
            f"skipped {self.duplicates} already applied, rejected {self.rejected}; "
            f"checkpoint {self.checkpoint}"
        )


class SyncService:
    """Moves new movements from one feed into the store, a page at a time.

    Each batch is applied in its own transaction, and the checkpoint is saved after it. A run that
    stops between the two fetches that batch again on the next run, and the store skips the
    movements it already has. Rejected records go to the dead-letter file before the checkpoint
    moves past them.
    """

    def __init__(
        self,
        feed: Feed,
        store: Store,
        checkpoints: CheckpointStore,
        *,
        dead_letters: DeadLetterFile | None = None,
        retrier: Retrier | None = None,
        page_size: int = 500,
        batch_size: int = 100,
    ):
        if page_size < 1 or batch_size < 1:
            raise ValueError("page_size and batch_size must be at least 1")
        self.feed = feed
        self.store = store
        self.checkpoints = checkpoints
        self.dead_letters = dead_letters
        self.retrier = retrier or Retrier(RetryPolicy())
        self.page_size = page_size
        self.batch_size = batch_size

    @classmethod
    def from_config(
        cls, config: SyncConfig, store: Store, feed: Feed | None = None, *, sleep: Callable[[float], None] = time.sleep
    ) -> "SyncService":
        policy = RetryPolicy(
            attempts=config.retry_attempts,
            base_delay=config.retry_base_delay,
            max_delay=config.retry_max_delay,
        )
        return cls(
            feed or feed_from_config(config),
            store,
            CheckpointStore(store.connection),
            dead_letters=DeadLetterFile(config.dead_letter_path) if config.dead_letter_path else None,
            retrier=Retrier(policy, sleep=sleep),
            page_size=config.page_size,
            batch_size=config.batch_size,
        )

    def _fetch(self, after: int) -> Page:
        return self.retrier.call(self.feed.fetch, after, self.page_size)

    def _advance(self, seq: int | None, result: SyncResult) -> None:
        if seq is not None and seq > result.checkpoint:
            self.checkpoints.save(self.feed.name, seq)
            result.checkpoint = seq

    def _reject(self, page: Page, result: SyncResult) -> None:
        for item in page.rejected:
            log.warning("rejected record %d from feed %s: %s", item.seq, self.feed.name, item.reason)
        if self.dead_letters is not None:
            self.dead_letters.write(page.rejected, self.feed.name)
        result.rejected += len(page.rejected)

    def _apply(self, page: Page, result: SyncResult) -> None:
        for batch in batched(page.movements, self.batch_size):
            result.applied += self.store.apply_batch(batch)
            self._advance(batch[-1].seq, result)

    def run_once(self) -> SyncResult:
        """Fetch and apply every movement after the checkpoint, until the feed has no more."""
        result = SyncResult(checkpoint=self.checkpoints.load(self.feed.name))
        while True:
            page = self._fetch(result.checkpoint)
            if len(page) == 0:
                break
            result.pages += 1
            result.fetched += len(page.movements)
            self._reject(page, result)
            self._apply(page, result)
            self._advance(page.last_seq, result)
            if len(page) < self.page_size:
                break
        log.info("feed %s: %s", self.feed.name, result.describe())
        return result

    def run_forever(
        self,
        stop: Stopper,
        *,
        poll_interval: float = 30.0,
        max_poll_interval: float = 300.0,
        on_result: Callable[[SyncResult], None] | None = None,
    ) -> None:
        """Run until `stop` is set, waiting between runs.

        The wait starts at `poll_interval` and doubles after each run that finds nothing new, up
        to `max_poll_interval`, so an idle feed is asked less often. A run that cannot reach the
        feed is logged, and the next run is tried after the usual wait.
        """
        if poll_interval <= 0 or max_poll_interval < poll_interval:
            raise ValueError("poll_interval must be positive and no longer than max_poll_interval")
        wait = poll_interval
        while not stop.is_set():
            try:
                result = self.run_once()
            except RetriesExhausted as exc:
                log.error("feed %s unavailable: %s", self.feed.name, exc)
            else:
                if on_result is not None:
                    on_result(result)
                if result.pages == 0:
                    wait = min(wait * 2, max_poll_interval)
            stop.wait(wait)
