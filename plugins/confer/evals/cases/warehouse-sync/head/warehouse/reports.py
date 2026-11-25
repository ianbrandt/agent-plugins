"""Text reports on stock levels, movements, and sync."""

from __future__ import annotations

import csv
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable, TextIO

from .models import Movement, StockLevel


def stock_report(levels: Iterable[StockLevel]) -> str:
    """A table of on-hand stock, grouped by location."""
    by_location: dict[str, list[StockLevel]] = defaultdict(list)
    for level in levels:
        by_location[level.location].append(level)
    lines = []
    for location in sorted(by_location):
        lines.append(location)
        for level in sorted(by_location[location], key=lambda item: item.sku):
            lines.append(f"  {level.sku:<14} {level.on_hand:>8}")
    return "\n".join(lines)


def low_stock(levels: Iterable[StockLevel], thresholds: dict[str, int], default: int = 0) -> list[StockLevel]:
    """Levels at or below the threshold for their SKU."""
    low = [level for level in levels if level.on_hand <= thresholds.get(level.sku, default)]
    return sorted(low, key=lambda level: (level.sku, level.location))


def movement_totals(movements: Iterable[Movement]) -> dict[str, int]:
    """Total quantity moved per movement kind."""
    totals: dict[str, int] = defaultdict(int)
    for movement in movements:
        totals[movement.kind] += movement.quantity
    return dict(totals)


def format_totals(totals: dict[str, int], since: datetime | None = None) -> str:
    heading = f"Movements since {since:%Y-%m-%d %H:%M}" if since else "All movements"
    lines = [heading]
    for kind in sorted(totals):
        lines.append(f"  {kind:<10} {totals[kind]:>8}")
    if not totals:
        lines.append("  none")
    return "\n".join(lines)


@dataclass(frozen=True)
class FeedStatus:
    """Where sync stands for one feed."""

    feed: str
    checkpoint: int
    updated_at: datetime | None
    dead_letters: int = 0


def format_age(elapsed: timedelta) -> str:
    """A short age such as 45s, 12m, or 3h05m."""
    seconds = max(0, int(elapsed.total_seconds()))
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m"
    return f"{seconds // 3600}h{seconds % 3600 // 60:02d}m"


def format_sync_status(statuses: Iterable[FeedStatus], now: datetime) -> str:
    """One line per feed with its checkpoint and when it last moved, plus any dead letters."""
    lines = []
    for status in sorted(statuses, key=lambda s: s.feed):
        if status.updated_at is None:
            moved = "never synced"
        else:
            moved = f"last advanced {format_age(now - status.updated_at)} ago"
        lines.append(f"{status.feed}: checkpoint {status.checkpoint}, {moved}")
        if status.dead_letters:
            lines.append(f"  {status.dead_letters} rejected records in the dead-letter file")
    if not lines:
        lines.append("no feeds synced yet")
    return "\n".join(lines)


def _reason_heading(reason: str) -> str:
    """The part of a reject reason before any record detail, so like rejects group together."""
    return reason.split(":", 1)[0].strip() or "unknown"


def dead_letter_summary(entries: Iterable[dict], limit: int = 10) -> str:
    """The most common reasons in the dead-letter file, with counts and the newest seq for each."""
    counts: dict[str, int] = defaultdict(int)
    newest: dict[str, int] = {}
    for entry in entries:
        heading = _reason_heading(entry.get("reason", ""))
        counts[heading] += 1
        newest[heading] = max(newest.get(heading, 0), int(entry.get("seq", 0)))
    if not counts:
        return "no rejected records"
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    lines = [f"{sum(counts.values())} rejected records"]
    for heading, count in ranked[:limit]:
        lines.append(f"  {count:>6}  {heading} (newest seq {newest[heading]})")
    if len(ranked) > limit:
        lines.append(f"  ... and {len(ranked) - limit} other reasons")
    return "\n".join(lines)


def daily_totals(movements: Iterable[Movement]) -> dict[str, dict[str, int]]:
    """Quantity moved per kind for each day, keyed by ISO date."""
    days: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for movement in movements:
        days[movement.occurred_at.date().isoformat()][movement.kind] += movement.quantity
    return {day: dict(kinds) for day, kinds in days.items()}


def format_daily_totals(days: dict[str, dict[str, int]]) -> str:
    kinds = sorted({kind for totals in days.values() for kind in totals})
    lines = [f"{'date':<10} " + " ".join(f"{kind:>8}" for kind in kinds)]
    for day in sorted(days):
        lines.append(f"{day:<10} " + " ".join(f"{days[day].get(kind, 0):>8}" for kind in kinds))
    return "\n".join(lines)


def net_change(movements: Iterable[Movement]) -> dict[tuple[str, str], int]:
    """The net change in on-hand stock for each (sku, location), leaving out those with none."""
    totals: dict[tuple[str, str], int] = defaultdict(int)
    for movement in movements:
        totals[(movement.sku, movement.location)] += movement.delta
    return {key: change for key, change in totals.items() if change}


def format_net_change(changes: dict[tuple[str, str], int], since: datetime | None = None) -> str:
    heading = f"Net change since {since:%Y-%m-%d %H:%M}" if since else "Net change"
    lines = [heading]
    for (sku, location), change in sorted(changes.items(), key=lambda item: (item[0][1], item[0][0])):
        lines.append(f"  {location:<12} {sku:<14} {change:>+8}")
    if not changes:
        lines.append("  none")
    return "\n".join(lines)


def write_net_change_csv(movements: Iterable[Movement], out: TextIO) -> int:
    """Write the net change per SKU and location as CSV and return how many rows were written."""
    changes = net_change(movements)
    writer = csv.writer(out)
    writer.writerow(["sku", "location", "net_change"])
    for (location, sku), change in sorted(changes.items()):
        writer.writerow([sku, location, change])
    return len(changes)
