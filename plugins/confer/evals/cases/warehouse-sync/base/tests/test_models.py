import unittest
from datetime import datetime

from warehouse.models import Movement

AT = datetime(2026, 3, 1, 9, 0)


class MovementTest(unittest.TestCase):
    def test_pick_delta_is_negative(self):
        self.assertEqual(Movement(1, "A100", "BIN-1", "pick", 3, AT).delta, -3)

    def test_receive_delta_is_positive(self):
        self.assertEqual(Movement(1, "A100", "BIN-1", "receive", 3, AT).delta, 3)

    def test_negative_adjustment_allowed(self):
        self.assertEqual(Movement(1, "A100", "BIN-1", "adjust", -2, AT).delta, -2)

    def test_pick_quantity_must_be_positive(self):
        with self.assertRaises(ValueError):
            Movement(1, "A100", "BIN-1", "pick", 0, AT)

    def test_unknown_kind(self):
        with self.assertRaises(ValueError):
            Movement(1, "A100", "BIN-1", "teleport", 1, AT)
