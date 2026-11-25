"""The booking sheet: a court's slots for one day, in club time."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from . import clock, window
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
    """The slots on `day` that no booking on the court covers."""
    start, end = clock.day_bounds(day)
    step = timedelta(minutes=SLOT_MINUTES)
    taken = set()
    for b in store.between(start, end, court_id=court_id):
        taken.update(b.start + step * i for i in range(b.length))
    return [s for s in day_slots(day) if clock.utc(s) not in taken]


def open_slots(
    store: BookingStore,
    court_id: str,
    day: date,
    tier: str,
    now: datetime,
    minutes: int = SLOT_MINUTES,
) -> list[datetime]:
    """The slots on `day` where a member of `tier` can book `minutes` at `now`."""
    free = free_slots(store, court_id, day)
    available = set(free)
    step = timedelta(minutes=SLOT_MINUTES)
    return [
        s
        for s in free
        if window.is_open(s, tier, now)
        and all(s + step * i in available for i in range(minutes // SLOT_MINUTES))
    ]
