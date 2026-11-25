import unittest
from datetime import date, datetime, timedelta, timezone

from courts.config import CLUB_TZ
from courts.window import is_open, last_open_day, opens_at


def club(month, day, hour, minute=0):
    return datetime(2026, month, day, hour, minute, tzinfo=CLUB_TZ)


class OpensAtTest(unittest.TestCase):
    def test_full_members_book_a_week_ahead(self):
        self.assertEqual(opens_at(club(3, 10, 18), "full"), club(3, 3, 7))

    def test_social_and_junior_members_book_three_days_ahead(self):
        self.assertEqual(opens_at(club(3, 10, 18), "social"), club(3, 7, 7))
        self.assertEqual(opens_at(club(3, 10, 18), "junior"), club(3, 7, 7))

    def test_every_slot_on_a_day_opens_together(self):
        self.assertEqual(opens_at(club(3, 10, 6), "full"), opens_at(club(3, 10, 21, 30), "full"))

    def test_start_in_utc(self):
        start = datetime(2026, 3, 10, 7, 0, tzinfo=timezone.utc)
        self.assertEqual(opens_at(start, "full"), club(3, 3, 7))

    def test_opening_across_the_end_of_daylight_saving(self):
        # Clocks go back on 5 April 2026: the slot is in standard time, the opening in daylight time.
        opening = opens_at(club(4, 8, 18), "full")
        self.assertEqual(opening, club(4, 1, 7))
        self.assertEqual(opening.utcoffset(), timedelta(hours=11))

    def test_unknown_tier(self):
        with self.assertRaises(ValueError):
            opens_at(club(3, 10, 18), "visitor")


class IsOpenTest(unittest.TestCase):
    def test_before_opening(self):
        self.assertFalse(is_open(club(3, 10, 18), "full", club(3, 3, 6, 59)))

    def test_from_opening(self):
        self.assertTrue(is_open(club(3, 10, 18), "full", club(3, 3, 7)))

    def test_until_the_slot_starts(self):
        self.assertTrue(is_open(club(3, 10, 18), "full", club(3, 10, 17, 59)))
        self.assertFalse(is_open(club(3, 10, 18), "full", club(3, 10, 18)))

    def test_now_in_utc(self):
        self.assertTrue(is_open(club(3, 10, 18), "full", datetime(2026, 3, 2, 20, 0, tzinfo=timezone.utc)))
        self.assertFalse(is_open(club(3, 10, 18), "full", datetime(2026, 3, 2, 19, 59, tzinfo=timezone.utc)))


class LastOpenDayTest(unittest.TestCase):
    def test_before_seven(self):
        self.assertEqual(last_open_day("full", club(3, 3, 6, 30)), date(2026, 3, 9))

    def test_from_seven(self):
        self.assertEqual(last_open_day("full", club(3, 3, 7)), date(2026, 3, 10))
        self.assertEqual(last_open_day("social", club(3, 3, 7)), date(2026, 3, 6))

    def test_now_in_utc_is_read_in_club_time(self):
        # 21:00 UTC on 2 March is 08:00 on 3 March in Sydney.
        self.assertEqual(last_open_day("full", datetime(2026, 3, 2, 21, 0, tzinfo=timezone.utc)), date(2026, 3, 10))


if __name__ == "__main__":
    unittest.main()
