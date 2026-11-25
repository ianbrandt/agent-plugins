"""Booking and cancelling courts under the club's rules."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Callable

from . import clock
from .config import CANCEL_NOTICE_HOURS, SLOT_MINUTES
from .models import Booking, Court, Member
from .slots import day_slots
from .store import BookingStore


class BookingError(Exception):
    """A booking or cancellation that the club's rules do not allow."""


class NotASlot(BookingError):
    pass


class SlotTaken(BookingError):
    pass


class TooLate(BookingError):
    pass


class BookingService:
    def __init__(self, store: BookingStore, now: Callable[[], datetime] = clock.now) -> None:
        self._store = store
        self._now = now

    def book(self, member: Member, court: Court, start: datetime) -> Booking:
        """Book the slot starting at `start` on `court` for `member`."""
        start = clock.utc(start)
        if clock.local(start) not in day_slots(clock.local(start).date()):
            raise NotASlot(f"{clock.local(start):%H:%M} is not the start of a slot")
        if start <= self._now():
            raise TooLate("that slot has already started")
        end = start + timedelta(minutes=SLOT_MINUTES)
        if self._store.between(start, end, court_id=court.id):
            raise SlotTaken(f"{court.name} is already booked at {clock.local(start):%H:%M}")
        return self._store.add(Booking(None, court.id, member.id, start))

    def cancel(self, booking_id: int, member: Member) -> None:
        """Cancel one of `member`'s bookings, given enough notice."""
        booking = self._store.get(booking_id)
        if booking.member_id != member.id:
            raise BookingError("that booking belongs to another member")
        if booking.start - self._now() < timedelta(hours=CANCEL_NOTICE_HOURS):
            raise TooLate(f"bookings can be cancelled until {CANCEL_NOTICE_HOURS} hours before they start")
        self._store.remove(booking_id)
