import io
import json
import os
import tempfile
import unittest
from unittest import mock

from warehouse.cli import main


def record(seq, kind="receive", qty=5, sku="A100", loc="BIN-1"):
    return {"seq": seq, "sku": sku, "loc": loc, "kind": kind, "qty": qty, "at": "2026-03-01T09:00:00"}


class CliTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmp.name, "stock.db")
        self.export = os.path.join(self.tmp.name, "export.jsonl")
        self.env = mock.patch.dict(os.environ, {"WAREHOUSE_FEED_PATH": self.export}, clear=False)
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def write_export(self, records):
        with open(self.export, "w", encoding="utf-8") as fh:
            fh.write("".join(json.dumps(r) + "\n" for r in records))

    def run_cli(self, *argv):
        out = io.StringIO()
        code = main(["--db", self.db, *argv], out=out)
        return code, out.getvalue()

    def test_sync_then_levels(self):
        self.write_export([record(1, qty=8), record(2, "pick", 3)])
        code, text = self.run_cli("sync")
        self.assertEqual(code, 0)
        self.assertIn("applied 2", text)
        self.assertIn("A100", self.run_cli("levels")[1])

    def test_sync_twice_applies_only_new_movements(self):
        self.write_export([record(1)])
        self.run_cli("sync")
        self.write_export([record(1), record(2)])
        self.assertIn("applied 1", self.run_cli("sync")[1])

    def test_sync_without_export_reports_unavailable(self):
        with mock.patch.dict(os.environ, {"WAREHOUSE_RETRY_ATTEMPTS": "1"}):
            code, _ = self.run_cli("sync")
        self.assertEqual(code, 2)

    def test_reconcile_reports_discrepancies(self):
        self.write_export([record(1, qty=10)])
        self.run_cli("sync")
        counts = os.path.join(self.tmp.name, "counts.csv")
        with open(counts, "w", encoding="utf-8") as fh:
            fh.write("sku,location,counted,counted_at\nA100,BIN-1,7,2026-03-02T07:00:00\n")
        code, text = self.run_cli("reconcile", counts)
        self.assertEqual(code, 3)
        self.assertIn("1 discrepancies", text)

    def test_net_change_csv(self):
        self.write_export([record(1, qty=10), record(2, "pick", 4, sku="B200", loc="BIN-2"), record(3, qty=4, sku="B200", loc="BIN-2")])
        self.run_cli("sync")
        path = os.path.join(self.tmp.name, "net.csv")
        code, text = self.run_cli("net-change", "--csv", path)
        self.assertEqual(code, 0)
        self.assertIn("wrote 1 rows", text)
