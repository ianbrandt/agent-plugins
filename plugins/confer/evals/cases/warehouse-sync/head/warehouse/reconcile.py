"""Comparing stored stock with a cycle count taken by hand."""

from __future__ import annotations

import csv
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable, TextIO

from .models import StockLevel

COLUMNS = ("sku", "location", "counted", "counted_at")


class CountFileError(ValueError):
    """A cycle count file could not be read."""


@dataclass(frozen=True)
class CycleCount:
    """The quantity found at a location when it was counted."""

    sku: str
    location: str
    counted: int
    counted_at: datetime

    def __post_init__(self):
        if not self.sku or not self.location:
            raise ValueError("sku and location are required")
        if self.counted < 0:
            raise ValueError(f"counted quantity cannot be negative: {self.counted}")


def read_counts(path) -> list[CycleCount]:
    """Read a CSV file of counts with the columns in COLUMNS, in any order."""
    path = Path(path)
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        missing = [column for column in COLUMNS if column not in (reader.fieldnames or [])]
        if missing:
            raise CountFileError(f"{path}: missing columns {', '.join(missing)}")
        counts = []
        for row in reader:
            try:
                counts.append(
                    CycleCount(
                        sku=row["sku"].strip(),
                        location=row["location"].strip(),
                        counted=int(row["counted"]),
                        counted_at=datetime.fromisoformat(row["counted_at"].strip()),
                    )
                )
            except (AttributeError, TypeError, ValueError) as exc:
                raise CountFileError(f"{path}:{reader.line_num}: {exc}") from exc
    return counts


def stale_counts(counts: Iterable[CycleCount], now: datetime, max_age: timedelta) -> list[CycleCount]:
    """Counts taken longer than `max_age` before `now`, which are too old to correct stock with."""
    return [count for count in counts if now - count.counted_at > max_age]


@dataclass(frozen=True)
class Discrepancy:
    """A count that does not match the stored level."""

    sku: str
    location: str
    on_hand: int
    counted: int

    @property
    def difference(self) -> int:
        """How far the count is above the stored level. Negative when stock is missing."""
        return self.counted - self.on_hand


@dataclass
class Reconciliation:
    matched: int = 0
    discrepancies: list[Discrepancy] = field(default_factory=list)
    uncounted: list[StockLevel] = field(default_factory=list)

    @property
    def clean(self) -> bool:
        return not self.discrepancies

    def by_location(self) -> dict[str, int]:
        """The number of discrepancies at each location."""
        return dict(Counter(d.location for d in self.discrepancies))


def reconcile(levels: Iterable[StockLevel], counts: Iterable[CycleCount], *, tolerance: int = 0) -> Reconciliation:
    """Compare each count with the stored level for its SKU and location.

    A difference of up to `tolerance` units either way is a match. Stored levels with stock that
    no count covers are listed as uncounted.
    """
    if tolerance < 0:
        raise ValueError(f"tolerance cannot be negative: {tolerance}")
    stored = {(level.sku, level.location): level.on_hand for level in levels}
    seen: set[tuple[str, str]] = set()
    result = Reconciliation()
    for count in counts:
        key = (count.sku, count.location)
        if key in seen:
            raise ValueError(f"{count.sku} at {count.location} is counted twice")
        seen.add(key)
        on_hand = stored.get(key, 0)
        if abs(count.counted - on_hand) <= tolerance:
            result.matched += 1
        else:
            result.discrepancies.append(Discrepancy(count.sku, count.location, on_hand, count.counted))
    result.discrepancies.sort(key=lambda d: (d.location, d.sku))
    result.uncounted = sorted(
        (StockLevel(sku, location, qty) for (sku, location), qty in stored.items() if (sku, location) not in seen and qty),
        key=lambda level: (level.location, level.sku),
    )
    return result


def format_reconciliation(result: Reconciliation) -> str:
    lines = [
        f"{result.matched} matched, {len(result.discrepancies)} discrepancies, {len(result.uncounted)} not counted"
    ]
    if result.discrepancies:
        lines.append("")
        lines.append(f"{'location':<12} {'sku':<14} {'stored':>8} {'counted':>8} {'diff':>6}")
        for d in result.discrepancies:
            lines.append(f"{d.location:<12} {d.sku:<14} {d.on_hand:>8} {d.counted:>8} {d.difference:>+6}")
    if result.uncounted:
        lines.append("")
        lines.append("Not counted:")
        for level in result.uncounted:
            lines.append(f"  {level.location} {level.sku} ({level.on_hand} stored)")
    return "\n".join(lines)


def write_discrepancies_csv(result: Reconciliation, out: TextIO) -> int:
    """Write the discrepancies as CSV and return how many rows were written."""
    writer = csv.writer(out)
    writer.writerow(["location", "sku", "stored", "counted", "difference"])
    for d in result.discrepancies:
        writer.writerow([d.location, d.sku, d.on_hand, d.counted, d.difference])
    return len(result.discrepancies)


def apply_corrections(store, result: Reconciliation, *, reference: str) -> int:
    """Bring each level with a discrepancy to its counted quantity, and return how many changed.

    Each correction is logged in the store as an adjustment that cites `reference`.
    """
    if not reference:
        raise ValueError("corrections need a reference to the count")
    for d in result.discrepancies:
        store.adjust_level(d.sku, d.location, d.on_hand - d.counted, f"cycle count {reference}")
    return len(result.discrepancies)
