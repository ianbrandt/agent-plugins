"""Members, courts, and bookings."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from .config import SLOT_MINUTES


@dataclass(frozen=True)
class Member:
    id: str
    name: str
    tier: str = "full"


@dataclass(frozen=True)
class Court:
    id: str
    name: str
    lights: bool = False


@dataclass(frozen=True)
class Booking:
    """A court booked by a member.

    `start` is an aware datetime in UTC. `length` is the number of consecutive
    slots booked, each SLOT_MINUTES long.
    """

    id: int | None
    court_id: str
    member_id: str
    start: datetime
    length: int = 1

    @property
    def end(self) -> datetime:
        return self.start + timedelta(minutes=SLOT_MINUTES * self.length)
