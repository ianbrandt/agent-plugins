"""Time helpers. Times are stored in UTC and shown in club time."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from .config import CLUB_TZ


def now() -> datetime:
    """The current time, as an aware datetime in UTC."""
    return datetime.now(timezone.utc)


def utc(dt: datetime) -> datetime:
    """`dt` in UTC. A naive datetime is rejected rather than guessed at."""
    if dt.tzinfo is None:
        raise ValueError(f"naive datetime: {dt!r}")
    return dt.astimezone(timezone.utc)


def local(dt: datetime) -> datetime:
    """`dt` in club time."""
    if dt.tzinfo is None:
        raise ValueError(f"naive datetime: {dt!r}")
    return dt.astimezone(CLUB_TZ)


def day_bounds(day: date) -> tuple[datetime, datetime]:
    """The start of `day` and of the day after, club time, both in UTC."""
    start = datetime.combine(day, time(0), tzinfo=CLUB_TZ)
    end = datetime.combine(day + timedelta(days=1), time(0), tzinfo=CLUB_TZ)
    return utc(start), utc(end)
