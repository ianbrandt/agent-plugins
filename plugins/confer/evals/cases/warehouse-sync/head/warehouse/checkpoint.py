"""How far into each feed the store has applied movements."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Callable

SCHEMA = """
CREATE TABLE IF NOT EXISTS checkpoints (
    feed TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    updated_at TEXT NOT NULL
)
"""


class CheckpointError(ValueError):
    """A checkpoint would move backwards."""


class CheckpointStore:
    """Checkpoints kept in the same database as the stock tables.

    A feed's checkpoint is the sequence number of the last movement applied from it, or 0 before
    the first. The next fetch asks the feed for the movements after it.
    """

    def __init__(self, conn: sqlite3.Connection, *, clock: Callable[[], datetime] | None = None):
        self._conn = conn
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        with self._conn:
            self._conn.execute(SCHEMA)

    def load(self, feed: str) -> int:
        row = self._conn.execute("SELECT seq FROM checkpoints WHERE feed = ?", (feed,)).fetchone()
        return row[0] if row else 0

    def updated_at(self, feed: str) -> datetime | None:
        row = self._conn.execute("SELECT updated_at FROM checkpoints WHERE feed = ?", (feed,)).fetchone()
        return datetime.fromisoformat(row[0]) if row else None

    def save(self, feed: str, seq: int) -> None:
        if seq < 0:
            raise CheckpointError(f"checkpoint for {feed} cannot be negative: {seq}")
        current = self.load(feed)
        if seq < current:
            raise CheckpointError(f"checkpoint for {feed} would move back from {current} to {seq}")
        with self._conn:
            self._conn.execute(
                "INSERT INTO checkpoints (feed, seq, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT (feed) DO UPDATE SET seq = excluded.seq, updated_at = excluded.updated_at",
                (feed, seq, self._clock().isoformat()),
            )

    def reset(self, feed: str) -> None:
        """Forget a feed's checkpoint, so the next sync starts from its first movement."""
        with self._conn:
            self._conn.execute("DELETE FROM checkpoints WHERE feed = ?", (feed,))

    def all(self) -> dict[str, int]:
        rows = self._conn.execute("SELECT feed, seq FROM checkpoints ORDER BY feed").fetchall()
        return dict(rows)
