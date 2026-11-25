"""Stock levels and the movements behind them, kept in SQLite."""

from __future__ import annotations

import sqlite3
from datetime import datetime

from .models import Movement, StockLevel

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
"""


class Store:
    def __init__(self, path=":memory:"):
        self._conn = sqlite3.connect(str(path))
        self._conn.executescript(SCHEMA)

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
        self._conn.execute(
            "INSERT INTO levels (sku, location, on_hand) VALUES (?, ?, ?) "
            "ON CONFLICT (sku, location) DO UPDATE SET on_hand = on_hand + excluded.on_hand",
            (movement.sku, movement.location, movement.delta),
        )

    def has_seq(self, seq: int) -> bool:
        row = self._conn.execute("SELECT 1 FROM movements WHERE seq = ?", (seq,)).fetchone()
        return row is not None

    def on_hand(self, sku: str, location: str) -> int:
        row = self._conn.execute(
            "SELECT on_hand FROM levels WHERE sku = ? AND location = ?", (sku, location)
        ).fetchone()
        return row[0] if row else 0

    def levels(self) -> list[StockLevel]:
        rows = self._conn.execute(
            "SELECT sku, location, on_hand FROM levels ORDER BY location, sku"
        ).fetchall()
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
