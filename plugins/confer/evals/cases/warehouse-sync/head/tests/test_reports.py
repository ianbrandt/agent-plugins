import io
import unittest
from datetime import datetime, timedelta, timezone

from warehouse.models import Movement, StockLevel
from warehouse.reports import (
    FeedStatus,
    format_net_change,
    format_sync_status,
    format_totals,
    low_stock,
    movement_totals,
    net_change,
    stock_report,
    write_net_change_csv,
)

AT = datetime(2026, 3, 1, 9, 0)
NOW = datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc)


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


class SyncStatusTest(unittest.TestCase):
    def test_status_lines(self):
        statuses = [
            FeedStatus("returns", 7, None),
            FeedStatus("main", 41, NOW - timedelta(minutes=5), dead_letters=2),
        ]
        self.assertEqual(
            format_sync_status(statuses, NOW).splitlines(),
            [
                "main: checkpoint 41, last advanced 5m ago",
                "  2 rejected records in the dead-letter file",
                "returns: checkpoint 7, never synced",
            ],
        )


class NetChangeTest(unittest.TestCase):
    def setUp(self):
        self.movements = [
            Movement(1, "A100", "BIN-1", "receive", 10, AT),
            Movement(2, "A100", "BIN-1", "pick", 3, AT),
            Movement(3, "A100", "BIN-1", "scrap", 2, AT),
            Movement(4, "B200", "BIN-2", "receive", 4, AT),
            Movement(5, "B200", "BIN-2", "pick", 4, AT),
        ]

    def test_net_change_leaves_out_zero(self):
        self.assertEqual(net_change(self.movements), {("A100", "BIN-1"): 5})

    def test_format(self):
        self.assertEqual(format_net_change(net_change(self.movements)), "Net change\n  BIN-1        A100                 +5")

    def test_csv(self):
        out = io.StringIO()
        self.assertEqual(write_net_change_csv(self.movements, out), 1)
        lines = out.getvalue().splitlines()
        self.assertEqual(lines[0], "sku,location,net_change")
        self.assertTrue(lines[1].endswith(",5"))
