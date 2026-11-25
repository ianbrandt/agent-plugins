import unittest
from datetime import datetime

from warehouse.models import Movement, StockLevel
from warehouse.store import Store

AT = datetime(2026, 3, 1, 9, 0)


def mv(seq, kind, qty, sku="A100", location="BIN-1", at=AT):
    return Movement(seq=seq, sku=sku, location=location, kind=kind, quantity=qty, occurred_at=at)


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.store = Store()

    def tearDown(self):
        self.store.close()

    def test_receive_then_pick(self):
        self.store.apply(mv(1, "receive", 10))
        self.store.apply(mv(2, "pick", 3))
        self.assertEqual(self.store.on_hand("A100", "BIN-1"), 7)

    def test_adjustment_keeps_its_sign(self):
        self.store.apply(mv(1, "receive", 10))
        self.store.apply(mv(2, "adjust", -4))
        self.assertEqual(self.store.on_hand("A100", "BIN-1"), 6)

    def test_unknown_level_is_zero(self):
        self.assertEqual(self.store.on_hand("A100", "BIN-9"), 0)

    def test_levels_sorted_by_location_then_sku(self):
        self.store.apply(mv(1, "receive", 5, sku="B200", location="BIN-2"))
        self.store.apply(mv(2, "receive", 7, sku="A100", location="BIN-2"))
        self.store.apply(mv(3, "receive", 1, sku="C300", location="BIN-1"))
        self.assertEqual(
            self.store.levels(),
            [StockLevel("C300", "BIN-1", 1), StockLevel("A100", "BIN-2", 7), StockLevel("B200", "BIN-2", 5)],
        )

    def test_movements_since(self):
        self.store.apply(mv(1, "receive", 5, at=datetime(2026, 3, 1)))
        self.store.apply(mv(2, "pick", 2, at=datetime(2026, 3, 3)))
        self.assertEqual([m.seq for m in self.store.movements(datetime(2026, 3, 2))], [2])
        self.assertEqual([m.seq for m in self.store.movements()], [1, 2])

    def test_has_seq(self):
        self.store.apply(mv(1, "receive", 5))
        self.assertTrue(self.store.has_seq(1))
        self.assertFalse(self.store.has_seq(2))
