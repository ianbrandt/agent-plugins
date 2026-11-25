"""The booking sheet: a court's slots for one day, in club time."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from . import clock
from .config import CLUB_TZ, FIRST_SLOT, LAST_SLOT, SLOT_MINUTES
from .store import BookingStore


def day_slots(day: date) -> list[datetime]:
    """The start of each slot on `day`, as aware datetimes in club time."""
    slot = datetime.combine(day, FIRST_SLOT, tzinfo=CLUB_TZ)
    last = datetime.combine(day, LAST_SLOT, tzinfo=CLUB_TZ)
    starts = []
    while slot <= last:
        starts.append(slot)
        slot += timedelta(minutes=SLOT_MINUTES)
    return starts


def free_slots(store: BookingStore, court_id: str, day: date) -> list[datetime]:
    """The slots on `day` with no booking on the court."""
    start, end = clock.day_bounds(day)
    taken = {b.start for b in store.between(start, end, court_id=court_id)}
    return [s for s in day_slots(day) if clock.utc(s) not in taken]
