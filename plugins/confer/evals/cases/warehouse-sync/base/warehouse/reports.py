"""Text reports on stock levels and movements."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Iterable

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
