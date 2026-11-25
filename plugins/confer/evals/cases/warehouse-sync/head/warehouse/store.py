"""Stock levels and the movements behind them, kept in SQLite."""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from typing import Iterable

from .models import Movement, StockLevel

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS movements (
    seq INTEGER PRIMARY KEY,
    sku TEXT NOT NULL,
    location TEXT NOT NULL,
    kind TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS levels (
    sku TEXT NOT NULL,
    location TEXT NOT NULL,
    on_hand INTEGER NOT NULL,
    PRIMARY KEY (sku, location)
);
CREATE TABLE IF NOT EXISTS adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL,
    location TEXT NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    made_at TEXT NOT NULL
);
"""


class Store:
    def __init__(self, path=":memory:"):
        self._conn = sqlite3.connect(str(path))
        self._conn.executescript(SCHEMA)

    @property
    def connection(self) -> sqlite3.Connection:
        """The database connection, for tables kept next to the stock, such as checkpoints."""
        return self._conn

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()

    def apply(self, movement: Movement) -> None:
        """Record a movement and update the level it changes, in one transaction."""
        with self._conn:
            self._insert(movement)

    def _insert(self, movement: Movement) -> None:
        self._conn.execute(
            "INSERT INTO movements (seq, sku, location, kind, quantity, occurred_at, reference) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                movement.seq,
                movement.sku,
                movement.location,
                movement.kind,
                movement.quantity,
                movement.occurred_at.isoformat(),
                movement.reference,
            ),
        )
        self._change_level(movement.sku, movement.location, movement.delta)

    def _change_level(self, sku: str, location: str, delta: int) -> None:
        self._conn.execute(
            "INSERT INTO levels (sku, location, on_hand) VALUES (?, ?, ?) "
            "ON CONFLICT (sku, location) DO UPDATE SET on_hand = on_hand + excluded.on_hand",
            (sku, location, delta),
        )

    def has_seq(self, seq: int) -> bool:
        row = self._conn.execute("SELECT 1 FROM movements WHERE seq = ?", (seq,)).fetchone()
        return row is not None

    def last_seq(self) -> int | None:
        """The highest sequence number applied, or None for an empty store."""
        return self._conn.execute("SELECT MAX(seq) FROM movements").fetchone()[0]

    def on_hand(self, sku: str, location: str) -> int:
        row = self._conn.execute(
            "SELECT on_hand FROM levels WHERE sku = ? AND location = ?", (sku, location)
        ).fetchone()
        return row[0] if row else 0

    def levels(self, location: str | None = None) -> list[StockLevel]:
        sql = "SELECT sku, location, on_hand FROM levels"
        params: tuple = ()
        if location is not None:
            sql += " WHERE location = ?"
            params = (location,)
        rows = self._conn.execute(sql + " ORDER BY location, sku", params).fetchall()
        return [StockLevel(*row) for row in rows]

    def movements(self, since: datetime | None = None) -> list[Movement]:
        sql = "SELECT seq, sku, location, kind, quantity, occurred_at, reference FROM movements"
        params: tuple = ()
        if since is not None:
            sql += " WHERE occurred_at >= ?"
            params = (since.isoformat(),)
        rows = self._conn.execute(sql + " ORDER BY seq", params).fetchall()
        return [
            Movement(seq, sku, location, kind, quantity, datetime.fromisoformat(at), reference)
            for seq, sku, location, kind, quantity, at, reference in rows
        ]

    def adjust_level(self, sku: str, location: str, delta: int, reason: str) -> None:
        """Change a level outside the feed, as after a cycle count, and log the reason.

        The change is not a movement: the next movement from the feed applies on top of it.
        """
        if not reason:
            raise ValueError("an adjustment needs a reason")
        with self._conn:
            self._change_level(sku, location, delta)
            self._conn.execute(
                "INSERT INTO adjustments (sku, location, delta, reason, made_at) VALUES (?, ?, ?, ?, ?)",
                (sku, location, delta, reason, datetime.now(timezone.utc).isoformat()),
            )

    def adjustments(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT sku, location, delta, reason, made_at FROM adjustments ORDER BY id"
        ).fetchall()
        return [
            {"sku": sku, "location": location, "delta": delta, "reason": reason, "made_at": made_at}
            for sku, location, delta, reason, made_at in rows
        ]

    def apply_batch(self, movements: Iterable[Movement]) -> int:
        """Apply movements in one transaction and return how many were new.

        The feed can deliver a movement again, as when a sync stops after applying a batch but
        before saving its checkpoint. A movement whose sequence number is already stored is
        skipped.
        """
        applied = 0
        try:
            with self._conn:
                for movement in movements:
                    self._insert(movement)
                    applied += 1
        except sqlite3.IntegrityError:
            log.info("batch was already applied; skipping it")
            return 0
        return applied
