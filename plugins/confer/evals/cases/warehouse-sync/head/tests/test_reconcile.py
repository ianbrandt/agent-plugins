import os
import tempfile
import unittest
from datetime import datetime

from warehouse.models import StockLevel
from warehouse.reconcile import (
    CountFileError,
    CycleCount,
    Discrepancy,
    apply_corrections,
    read_counts,
    reconcile,
)

COUNTED_AT = datetime(2026, 3, 2, 7, 0)


def count(sku, location, counted):
    return CycleCount(sku, location, counted, COUNTED_AT)


class ReadCountsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "counts.csv")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, text):
        with open(self.path, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)

    def test_reads_rows_in_any_column_order(self):
        self.write("location,sku,counted_at,counted\nBIN-1, A100 ,2026-03-02T07:00:00,12\n")
        self.assertEqual(read_counts(self.path), [count("A100", "BIN-1", 12)])

    def test_bad_row_reports_its_line(self):
        self.write("sku,location,counted,counted_at\nA100,BIN-1,12,2026-03-02\nB200,BIN-1,many,2026-03-02\n")
        with self.assertRaisesRegex(CountFileError, ":3:"):
            read_counts(self.path)


class ReconcileTest(unittest.TestCase):
    def test_matches_and_discrepancies(self):
        levels = [StockLevel("A100", "BIN-1", 10), StockLevel("B200", "BIN-1", 4)]
        result = reconcile(levels, [count("A100", "BIN-1", 10), count("B200", "BIN-1", 1)])
        self.assertEqual(result.matched, 1)
        self.assertEqual(result.discrepancies, [Discrepancy("B200", "BIN-1", 4, 1)])
        self.assertEqual(result.discrepancies[0].difference, -3)

    def test_tolerance_is_inclusive(self):
        result = reconcile([StockLevel("A100", "BIN-1", 10)], [count("A100", "BIN-1", 12)], tolerance=2)
        self.assertTrue(result.clean)

    def test_uncounted_levels_with_stock(self):
        levels = [StockLevel("A100", "BIN-1", 10), StockLevel("B200", "BIN-2", 5), StockLevel("C300", "BIN-2", 0)]
        result = reconcile(levels, [count("A100", "BIN-1", 10)])
        self.assertEqual(result.uncounted, [StockLevel("B200", "BIN-2", 5)])


class RecordingStore:
    def __init__(self):
        self.calls = []

    def adjust_level(self, sku, location, delta, reason):
        self.calls.append((sku, location, reason))


class ApplyCorrectionsTest(unittest.TestCase):
    def test_one_adjustment_per_discrepancy(self):
        levels = [StockLevel("A100", "BIN-1", 10), StockLevel("B200", "BIN-2", 4)]
        result = reconcile(levels, [count("A100", "BIN-1", 7), count("B200", "BIN-2", 4)])
        store = RecordingStore()
        self.assertEqual(apply_corrections(store, result, reference="2026-03-02"), 1)
        self.assertEqual(store.calls, [("A100", "BIN-1", "cycle count 2026-03-02")])

    def test_needs_a_reference(self):
        with self.assertRaises(ValueError):
            apply_corrections(RecordingStore(), reconcile([], []), reference="")
