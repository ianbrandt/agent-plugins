"""Reading movements from the warehouse management system.

`read_movements` reads a whole export file at once. `FileFeed` and `HttpFeed` serve the same
records a page at a time, after a given sequence number, for incremental sync.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .models import Movement

# Status codes after which the same request is worth sending again.
RETRYABLE_STATUS = frozenset({429, 502, 503, 504})


class FeedError(ValueError):
    """A record or response from the feed could not be read."""


class FeedUnavailable(Exception):
    """The feed could not be reached. The same request may succeed later.

    `retry_after_ms` is how long the server asked the client to wait, in milliseconds, when it
    said.
    """

    def __init__(self, message: str, retry_after_ms: int | None = None):
        super().__init__(message)
        self.retry_after_ms = retry_after_ms


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


@dataclass(frozen=True)
class Rejected:
    """A record the feed delivered that is not a valid movement."""

    seq: int
    record: dict
    reason: str


@dataclass
class Page:
    """The records after a sequence number, in order, split into movements and rejects."""

    movements: list[Movement] = field(default_factory=list)
    rejected: list[Rejected] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.movements) + len(self.rejected)

    @property
    def last_seq(self) -> int | None:
        seqs = [m.seq for m in self.movements] + [r.seq for r in self.rejected]
        return max(seqs) if seqs else None


def _record_seq(record) -> int:
    try:
        return int(record["seq"])
    except (KeyError, TypeError, ValueError) as exc:
        raise FeedError(f"record without a sequence number: {record!r}") from exc


def page_from_records(records, after: int, limit: int) -> Page:
    """Build a page of up to `limit` records with a sequence number above `after`.

    A record that is not a valid movement is rejected rather than failing the page, so one bad
    record does not stop the sync. A record without a sequence number does fail it, since there
    is no way to step past it.
    """
    if limit < 1:
        raise ValueError(f"limit must be at least 1: {limit}")
    numbered = sorted(((_record_seq(record), record) for record in records), key=lambda pair: pair[0])
    page = Page()
    for seq, record in numbered:
        if seq <= after:
            continue
        if len(page) >= limit:
            break
        try:
            page.movements.append(parse_movement(record))
        except FeedError as exc:
            page.rejected.append(Rejected(seq, record, str(exc.__cause__ or exc)))
    return page


class FileFeed:
    """A feed read from an export file that the warehouse system appends to."""

    def __init__(self, path, name: str = "main"):
        self.path = Path(path)
        self.name = name

    def fetch(self, after: int, limit: int) -> Page:
        try:
            text = self.path.read_text(encoding="utf-8")
        except FileNotFoundError as exc:
            raise FeedUnavailable(f"export file {self.path} is missing") from exc
        lines = text.split("\n")
        # The last line is still being written when the file does not end in a newline.
        complete = lines[:-1]
        records = []
        for number, line in enumerate(complete, start=1):
            if not line.strip():
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise FeedError(f"{self.path}:{number}: not JSON: {exc}") from exc
        return page_from_records(records, after, limit)


def _retry_after_ms(headers) -> int | None:
    """Read a Retry-After header, which is given in seconds."""
    value = headers.get("Retry-After") if headers is not None else None
    if value is None:
        return None
    try:
        seconds = float(value)
    except ValueError:
        return None
    return max(0, int(seconds * 1000))


class HttpFeed:
    """A feed served over HTTP.

    GET <url>?after=<seq>&limit=<n> returns {"movements": [record, ...]}.
    """

    def __init__(self, url: str, name: str = "main", *, timeout: float = 10.0, opener=urllib.request.urlopen):
        self.url = url.rstrip("?")
        self.name = name
        self.timeout = timeout
        self._open = opener

    def fetch(self, after: int, limit: int) -> Page:
        query = urllib.parse.urlencode({"after": after, "limit": limit})
        try:
            with self._open(f"{self.url}?{query}", timeout=self.timeout) as response:
                body = json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code in RETRYABLE_STATUS:
                raise FeedUnavailable(f"feed returned {exc.code}", _retry_after_ms(exc.headers)) from exc
            raise FeedError(f"feed returned {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise FeedUnavailable(f"feed unreachable: {exc}") from exc
        except ValueError as exc:
            raise FeedError(f"feed response is not JSON: {exc}") from exc
        records = body.get("movements") if isinstance(body, dict) else None
        if not isinstance(records, list):
            raise FeedError("feed response has no movements list")
        return page_from_records(records, after, limit)
