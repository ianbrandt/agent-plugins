"""When booking opens for a slot.

A member can book a slot from OPENS_AT, club time, a number of days before the
slot's date that depends on the member's tier, until the slot starts.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from . import clock
from .config import ADVANCE_DAYS, CLUB_TZ, OPENS_AT


def opens_at(start: datetime, tier: str) -> datetime:
    """When a member of `tier` can first book the slot starting at `start`."""
    day = start.date()
    try:
        days_ahead = ADVANCE_DAYS[tier]
    except KeyError:
        raise ValueError(f"unknown tier: {tier!r}") from None
    return datetime.combine(day - timedelta(days=days_ahead), OPENS_AT, tzinfo=CLUB_TZ)


def is_open(start: datetime, tier: str, now: datetime) -> bool:
    """Whether a member of `tier` can book the slot starting at `start` at `now`."""
    return opens_at(start, tier) <= now < start


def last_open_day(tier: str, now: datetime) -> date:
    """The last day, club time, with slots a member of `tier` can book at `now`."""
    today = clock.local(now)
    last = today.date() + timedelta(days=ADVANCE_DAYS[tier])
    if today.time() < OPENS_AT:
        last -= timedelta(days=1)
    return last
