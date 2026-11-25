import unittest
from datetime import datetime

from warehouse.models import Movement, StockLevel
from warehouse.reports import format_totals, low_stock, movement_totals, stock_report

AT = datetime(2026, 3, 1, 9, 0)


class ReportsTest(unittest.TestCase):
    def test_stock_report_groups_by_location(self):
        text = stock_report([StockLevel("A100", "BIN-2", 4), StockLevel("B200", "BIN-1", 9)])
        self.assertEqual(text.splitlines()[0], "BIN-1")
        self.assertIn("B200", text.splitlines()[1])

    def test_low_stock_includes_threshold(self):
        levels = [StockLevel("A100", "BIN-1", 5), StockLevel("A100", "BIN-2", 6)]
        self.assertEqual(low_stock(levels, {"A100": 5}), [StockLevel("A100", "BIN-1", 5)])

    def test_movement_totals(self):
        movements = [
            Movement(1, "A100", "BIN-1", "receive", 10, AT),
            Movement(2, "A100", "BIN-1", "pick", 3, AT),
            Movement(3, "B200", "BIN-1", "pick", 2, AT),
        ]
        self.assertEqual(movement_totals(movements), {"receive": 10, "pick": 5})

    def test_format_totals_empty(self):
        self.assertEqual(format_totals({}), "All movements\n  none")
