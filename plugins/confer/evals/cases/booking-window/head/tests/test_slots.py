import unittest
from datetime import date, datetime, time

from courts.config import CLUB_TZ
from courts.models import Booking
from courts.slots import day_slots, free_slots, open_slots
from courts.store import BookingStore

DAY = date(2026, 3, 4)
NOW = datetime(2026, 3, 2, 9, 0, tzinfo=CLUB_TZ)


def at(hour, minute=0, day=DAY):
    return datetime.combine(day, time(hour, minute), tzinfo=CLUB_TZ)


class DaySlotsTest(unittest.TestCase):
    def test_first_and_last_slot(self):
        slots = day_slots(DAY)
        self.assertEqual((slots[0], slots[-1]), (at(6), at(21, 30)))
        self.assertEqual(len(slots), 32)

    def test_slots_are_in_club_time(self):
        self.assertEqual(day_slots(DAY)[0].tzinfo, CLUB_TZ)

    def test_day_daylight_saving_ends(self):
        # Clocks go back at 03:00 on 5 April 2026, before the first slot.
        slots = day_slots(date(2026, 4, 5))
        self.assertEqual(len(slots), 32)
        self.assertEqual(slots[0].utcoffset().total_seconds(), 10 * 3600)


class FreeSlotsTest(unittest.TestCase):
    def setUp(self):
        self.store = BookingStore()

    def test_all_free(self):
        self.assertEqual(free_slots(self.store, "c1", DAY), day_slots(DAY))

    def test_booked_slot_is_not_free(self):
        self.store.add(Booking(None, "c1", "m1", at(7)))
        self.assertNotIn(at(7), free_slots(self.store, "c1", DAY))
        self.assertIn(at(7, 30), free_slots(self.store, "c1", DAY))

    def test_longer_booking_covers_each_of_its_slots(self):
        self.store.add(Booking(None, "c1", "m1", at(7), length=3))
        free = free_slots(self.store, "c1", DAY)
        self.assertEqual([s for s in (at(7), at(7, 30), at(8), at(8, 30)) if s in free], [at(8, 30)])

    def test_other_court_and_other_day_do_not_count(self):
        self.store.add(Booking(None, "c2", "m1", at(7)))
        self.store.add(Booking(None, "c1", "m1", at(7, day=date(2026, 3, 5))))
        self.assertIn(at(7), free_slots(self.store, "c1", DAY))


class OpenSlotsTest(unittest.TestCase):
    def setUp(self):
        self.store = BookingStore()

    def test_open_within_the_window(self):
        self.assertEqual(open_slots(self.store, "c1", DAY, "social", NOW), day_slots(DAY))
        self.assertEqual(open_slots(self.store, "c1", date(2026, 3, 6), "social", NOW), [])
        self.assertEqual(len(open_slots(self.store, "c1", date(2026, 3, 6), "full", NOW)), 32)

    def test_slots_already_started_are_not_open(self):
        open_now = open_slots(self.store, "c1", NOW.date(), "full", NOW)
        self.assertEqual(open_now[0], at(9, 30, day=NOW.date()))

    def test_longer_booking_needs_free_slots_in_a_row(self):
        self.store.add(Booking(None, "c1", "m1", at(8)))
        open_hour = open_slots(self.store, "c1", DAY, "full", NOW, minutes=60)
        self.assertNotIn(at(7, 30), open_hour)
        self.assertNotIn(at(8), open_hour)
        self.assertIn(at(8, 30), open_hour)
        self.assertIn(at(21), open_hour)
        self.assertNotIn(at(21, 30), open_hour)


if __name__ == "__main__":
    unittest.main()
