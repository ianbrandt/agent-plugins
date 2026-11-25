"""Records from the feed that could not be applied, kept for someone to look at."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable

from .feed import Rejected


class DeadLetterFile:
    """An append-only JSON lines file of rejected records."""

    def __init__(self, path, *, clock: Callable[[], datetime] | None = None):
        self.path = Path(path)
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def write(self, rejected: Iterable[Rejected], feed: str) -> int:
        """Append the records and return how many were written.

        The file is synced before returning, so the caller can move its checkpoint past them.
        """
        now = self._clock().isoformat()
        entries = [
            {"feed": feed, "seq": item.seq, "reason": item.reason, "record": item.record, "rejected_at": now}
            for item in rejected
        ]
        if not entries:
            return 0
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as fh:
            for entry in entries:
                fh.write(json.dumps(entry, sort_keys=True) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        return len(entries)

    def read(self) -> list[dict]:
        if not self.path.exists():
            return []
        with self.path.open(encoding="utf-8") as fh:
            return [json.loads(line) for line in fh if line.strip()]

    def count(self, feed: str | None = None) -> int:
        return sum(1 for entry in self.read() if feed is None or entry["feed"] == feed)
