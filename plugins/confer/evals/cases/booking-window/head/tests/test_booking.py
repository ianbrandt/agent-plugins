import unittest
from datetime import datetime, time, timezone

from courts.booking import (
    BookingError,
    BookingService,
    NotASlot,
    NotOpenYet,
    SlotTaken,
    TooLate,
)
from courts.config import CLUB_TZ
from courts.models import Court, Member
from courts.store import BookingStore

NOW = datetime(2026, 3, 2, 9, 0, tzinfo=CLUB_TZ)
ANA = Member("m1", "Ana")
BEN = Member("m2", "Ben")
CARA = Member("m3", "Cara", tier="social")
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


class LengthTest(unittest.TestCase):
    def setUp(self):
        self.store = BookingStore()
        self.service = BookingService(self.store, now=lambda: NOW)

    def test_ninety_minutes(self):
        booking = self.service.book(ANA, COURT_1, at(4, 18), minutes=90)
        self.assertEqual(booking.end, at(4, 19, 30))

    def test_length_is_whole_slots_up_to_the_maximum(self):
        for minutes in (0, 45, 120):
            with self.subTest(minutes=minutes), self.assertRaises(NotASlot):
                self.service.book(ANA, COURT_1, at(4, 18), minutes=minutes)

    def test_booking_cannot_run_past_the_last_slot(self):
        self.service.book(ANA, COURT_1, at(4, 21), minutes=60)
        with self.assertRaises(NotASlot):
            self.service.book(BEN, COURT_2, at(4, 21), minutes=90)

    def test_longer_booking_blocks_the_slots_it_covers(self):
        self.service.book(ANA, COURT_1, at(4, 18), minutes=90)
        for start in (at(4, 18, 30), at(4, 19)):
            with self.subTest(start=start), self.assertRaises(SlotTaken):
                self.service.book(BEN, COURT_1, start)
        with self.assertRaises(SlotTaken):
            self.service.book(BEN, COURT_1, at(4, 17, 30), minutes=60)
        self.service.book(BEN, COURT_1, at(4, 19, 30))

    def test_booking_can_end_where_another_starts(self):
        self.service.book(ANA, COURT_1, at(4, 18, 30))
        self.service.book(BEN, COURT_1, at(4, 17, 30), minutes=60)


class MemberRulesTest(unittest.TestCase):
    def setUp(self):
        self.store = BookingStore()
        self.service = BookingService(self.store, now=lambda: NOW)

    def test_member_cannot_be_on_two_courts_at_once(self):
        self.service.book(ANA, COURT_1, at(4, 18))
        with self.assertRaises(SlotTaken):
            self.service.book(ANA, COURT_2, at(4, 18))
        self.service.book(ANA, COURT_2, at(4, 18, 30))

    def test_two_hours_in_a_day(self):
        self.service.book(ANA, COURT_1, at(4, 7), minutes=60)
        self.service.book(ANA, COURT_1, at(4, 18), minutes=60)
        self.assertEqual(len(self.store.between(at(4, 0), at(5, 0), member_id=ANA.id)), 2)

    def test_daily_limit_is_per_club_day(self):
        self.service.book(ANA, COURT_1, at(4, 20), minutes=90)
        self.service.book(ANA, COURT_1, at(5, 6), minutes=90)


class WindowTest(unittest.TestCase):
    def setUp(self):
        self.store = BookingStore()

    def service(self, now):
        return BookingService(self.store, now=lambda: now)

    def test_full_member_books_a_week_ahead(self):
        self.service(NOW).book(ANA, COURT_1, at(9, 18))
        with self.assertRaises(NotOpenYet) as raised:
            self.service(NOW).book(ANA, COURT_1, at(10, 18))
        self.assertEqual(str(raised.exception), "booking for that slot opens Tue 03 Mar at 07:00")

    def test_social_member_books_three_days_ahead(self):
        self.service(NOW).book(CARA, COURT_1, at(5, 18))
        with self.assertRaises(NotOpenYet):
            self.service(NOW).book(CARA, COURT_1, at(6, 18))

    def test_window_opens_at_seven(self):
        with self.assertRaises(NotOpenYet):
            self.service(at(3, 6, 59)).book(ANA, COURT_1, at(10, 18))
        self.service(at(3, 7)).book(ANA, COURT_1, at(10, 18))


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
