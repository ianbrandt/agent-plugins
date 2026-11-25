"""Reading movements from the warehouse export."""

from __future__ import annotations

import json
from datetime import datetime

from .models import Movement


class FeedError(ValueError):
    """A record from the export could not be read."""


def parse_movement(record: dict) -> Movement:
    try:
        return Movement(
            seq=int(record["seq"]),
            sku=str(record["sku"]),
            location=str(record["loc"]),
            kind=str(record["kind"]),
            quantity=int(record["qty"]),
            occurred_at=datetime.fromisoformat(record["at"]),
            reference=str(record.get("ref", "")),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise FeedError(f"bad movement record {record!r}: {exc}") from exc


def read_movements(path) -> list[Movement]:
    """Read a whole export file. Any bad record fails the read."""
    with open(path, encoding="utf-8") as fh:
        return [parse_movement(json.loads(line)) for line in fh if line.strip()]
