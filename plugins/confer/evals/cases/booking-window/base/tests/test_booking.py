import unittest
from datetime import datetime, time, timezone

from courts.booking import BookingError, BookingService, NotASlot, SlotTaken, TooLate
from courts.config import CLUB_TZ
from courts.models import Court, Member
from courts.store import BookingStore

NOW = datetime(2026, 3, 2, 9, 0, tzinfo=CLUB_TZ)
ANA = Member("m1", "Ana")
BEN = Member("m2", "Ben")
COURT_1 = Court("c1", "Court 1")
COURT_2 = Court("c2", "Court 2", lights=True)


def at(day, hour, minute=0):
    return datetime(2026, 3, day, hour, minute, tzinfo=CLUB_TZ)


class BookTest(unittest.TestCase):
    def setUp(self):
        self.store = BookingStore()
        self.service = BookingService(self.store, now=lambda: NOW)

    def test_booking_is_stored_in_utc(self):
        booking = self.service.book(ANA, COURT_1, at(4, 18))
        self.assertEqual(booking.start, datetime(2026, 3, 4, 7, 0, tzinfo=timezone.utc))
        self.assertEqual(self.store.get(booking.id), booking)

    def test_slot_must_start_on_the_sheet(self):
        with self.assertRaises(NotASlot):
            self.service.book(ANA, COURT_1, at(4, 18, 15))
        with self.assertRaises(NotASlot):
            self.service.book(ANA, COURT_1, at(4, 22))

    def test_started_slot_cannot_be_booked(self):
        with self.assertRaises(TooLate):
            self.service.book(ANA, COURT_1, at(2, 9))

    def test_taken_slot(self):
        self.service.book(ANA, COURT_1, at(4, 18))
        with self.assertRaises(SlotTaken):
            self.service.book(BEN, COURT_1, at(4, 18))
        self.service.book(BEN, COURT_2, at(4, 18))
        self.service.book(BEN, COURT_1, at(4, 18, 30))

    def test_naive_start_is_rejected(self):
        with self.assertRaises(ValueError):
            self.service.book(ANA, COURT_1, datetime.combine(NOW.date(), time(18)))


class CancelTest(unittest.TestCase):
    def setUp(self):
        self.store = BookingStore()
        self.service = BookingService(self.store, now=lambda: NOW)

    def test_cancel_with_notice(self):
        booking = self.service.book(ANA, COURT_1, at(4, 18))
        self.service.cancel(booking.id, ANA)
        self.assertEqual(self.store.between(at(4, 0), at(5, 0)), [])

    def test_cancel_without_notice(self):
        booking = self.service.book(ANA, COURT_1, at(3, 8))
        with self.assertRaises(TooLate):
            self.service.cancel(booking.id, ANA)

    def test_only_the_member_can_cancel(self):
        booking = self.service.book(ANA, COURT_1, at(4, 18))
        with self.assertRaises(BookingError):
            self.service.cancel(booking.id, BEN)


if __name__ == "__main__":
    unittest.main()
