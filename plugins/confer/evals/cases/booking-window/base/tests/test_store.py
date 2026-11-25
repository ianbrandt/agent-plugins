import unittest
from datetime import datetime, timezone

from courts.models import Booking
from courts.store import BookingStore


def at(hour, minute=0):
    return datetime(2026, 3, 4, hour, minute, tzinfo=timezone.utc)


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.store = BookingStore()

    def test_add_sets_the_id(self):
        first = self.store.add(Booking(None, "c1", "m1", at(7)))
        second = self.store.add(Booking(None, "c1", "m1", at(8)))
        self.assertEqual((first.id, second.id), (1, 2))
        self.assertEqual(self.store.get(2), second)

    def test_between_is_earliest_first(self):
        self.store.add(Booking(None, "c1", "m1", at(9)))
        self.store.add(Booking(None, "c2", "m2", at(7)))
        self.assertEqual([b.start for b in self.store.between(at(0), at(23))], [at(7), at(9)])

    def test_between_includes_start_and_excludes_end(self):
        self.store.add(Booking(None, "c1", "m1", at(7)))
        self.store.add(Booking(None, "c1", "m1", at(8)))
        self.assertEqual([b.start for b in self.store.between(at(7), at(8))], [at(7)])

    def test_between_narrows_by_court_and_member(self):
        self.store.add(Booking(None, "c1", "m1", at(7)))
        self.store.add(Booking(None, "c2", "m1", at(7)))
        self.store.add(Booking(None, "c2", "m2", at(8)))
        self.assertEqual(len(self.store.between(at(0), at(23), court_id="c2")), 2)
        self.assertEqual(len(self.store.between(at(0), at(23), court_id="c2", member_id="m1")), 1)

    def test_remove(self):
        booking = self.store.add(Booking(None, "c1", "m1", at(7)))
        self.store.remove(booking.id)
        self.assertEqual(self.store.between(at(0), at(23)), [])


if __name__ == "__main__":
    unittest.main()
