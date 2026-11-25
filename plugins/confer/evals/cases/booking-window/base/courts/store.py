"""Bookings, kept in memory."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime

from .models import Booking


class BookingStore:
    def __init__(self) -> None:
        self._by_id: dict[int, Booking] = {}
        self._next_id = 1

    def add(self, booking: Booking) -> Booking:
        """Store `booking` and return it with its id set."""
        stored = replace(booking, id=self._next_id)
        self._next_id += 1
        self._by_id[stored.id] = stored
        return stored

    def get(self, booking_id: int) -> Booking:
        return self._by_id[booking_id]

    def remove(self, booking_id: int) -> Booking:
        return self._by_id.pop(booking_id)

    def between(
        self,
        start: datetime,
        end: datetime,
        *,
        court_id: str | None = None,
        member_id: str | None = None,
    ) -> list[Booking]:
        """Bookings starting at or after `start` and before `end`, earliest first.

        `court_id` and `member_id` narrow the result to one court or one member.
        """
        found = [
            b
            for b in self._by_id.values()
            if start <= b.start < end
            and (court_id is None or b.court_id == court_id)
            and (member_id is None or b.member_id == member_id)
        ]
        return sorted(found, key=lambda b: b.start)
