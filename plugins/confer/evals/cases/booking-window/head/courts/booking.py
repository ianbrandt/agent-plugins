"""Booking and cancelling courts under the club's rules."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Callable

from . import clock, window
from .config import CANCEL_NOTICE_HOURS, DAILY_MINUTES, MAX_MINUTES, SLOT_MINUTES
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


class NotOpenYet(BookingError):
    pass


class OverDailyLimit(BookingError):
    pass


class BookingService:
    def __init__(self, store: BookingStore, now: Callable[[], datetime] = clock.now) -> None:
        self._store = store
        self._now = now

    def book(self, member: Member, court: Court, start: datetime, minutes: int = SLOT_MINUTES) -> Booking:
        """Book `minutes` on `court` for `member`, from the slot starting at `start`."""
        start = clock.utc(start)
        if minutes % SLOT_MINUTES or not SLOT_MINUTES <= minutes <= MAX_MINUTES:
            raise NotASlot(f"bookings are {SLOT_MINUTES} to {MAX_MINUTES} minutes, in {SLOT_MINUTES}-minute slots")
        sheet = day_slots(clock.local(start).date())
        step = timedelta(minutes=SLOT_MINUTES)
        if any(clock.local(start) + step * i not in sheet for i in range(minutes // SLOT_MINUTES)):
            raise NotASlot(f"{minutes} minutes from {clock.local(start):%H:%M} is not on the booking sheet")
        now = self._now()
        if start <= now:
            raise TooLate("that slot has already started")
        if not window.is_open(start, member.tier, now):
            opens = clock.local(window.opens_at(start, member.tier))
            raise NotOpenYet(f"booking for that slot opens {opens:%a %d %b} at {opens:%H:%M}")
        booking = Booking(None, court.id, member.id, start, length=minutes // SLOT_MINUTES)
        running = self._store.between(start - timedelta(minutes=MAX_MINUTES - SLOT_MINUTES), booking.end, court_id=court.id)
        if any(b.end > start for b in running):
            raise SlotTaken(f"{court.name} is already booked at {clock.local(start):%H:%M}")
        self._check_member(member, start, booking.end, minutes)
        return self._store.add(booking)

    def _check_member(self, member: Member, start: datetime, end: datetime, minutes: int) -> None:
        """Refuse a booking that clashes with the member's own, or takes them over the daily limit."""
        if self._store.between(start, end, member_id=member.id):
            raise SlotTaken(f"{member.name} already has a court at {clock.local(start):%H:%M}")
        day_start, day_end = clock.day_bounds(clock.local(start).date())
        booked = sum(b.length for b in self._store.between(day_start, day_end, member_id=member.id))
        if booked + minutes > DAILY_MINUTES:
            raise OverDailyLimit(f"{member.name} can book at most {DAILY_MINUTES} minutes a day")

    def cancel(self, booking_id: int, member: Member) -> None:
        """Cancel one of `member`'s bookings, given enough notice."""
        booking = self._store.get(booking_id)
        if booking.member_id != member.id:
            raise BookingError("that booking belongs to another member")
        if booking.start - self._now() < timedelta(hours=CANCEL_NOTICE_HOURS):
            raise TooLate(f"bookings can be cancelled until {CANCEL_NOTICE_HOURS} hours before they start")
        self._store.remove(booking_id)
