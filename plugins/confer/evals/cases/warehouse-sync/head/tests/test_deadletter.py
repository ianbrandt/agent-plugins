import os
import tempfile
import unittest
from datetime import datetime, timezone

from warehouse.deadletter import DeadLetterFile
from warehouse.feed import Rejected

NOW = datetime(2026, 3, 1, 9, 30, tzinfo=timezone.utc)


class DeadLetterFileTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dead = DeadLetterFile(os.path.join(self.tmp.name, "dead", "rejects.jsonl"), clock=lambda: NOW)

    def tearDown(self):
        self.tmp.cleanup()

    def test_missing_file_reads_empty(self):
        self.assertEqual(self.dead.read(), [])
        self.assertEqual(self.dead.count(), 0)

    def test_write_appends(self):
        self.dead.write([Rejected(4, {"seq": 4}, "missing sku")], "main")
        self.dead.write([Rejected(9, {"seq": 9}, "bad qty"), Rejected(10, {"seq": 10}, "bad qty")], "main")
        entries = self.dead.read()
        self.assertEqual([entry["seq"] for entry in entries], [4, 9, 10])
        self.assertEqual(entries[0]["rejected_at"], NOW.isoformat())
        self.assertEqual(entries[0]["record"], {"seq": 4})

    def test_write_nothing_creates_no_file(self):
        self.assertEqual(self.dead.write([], "main"), 0)
        self.assertFalse(self.dead.path.exists())
