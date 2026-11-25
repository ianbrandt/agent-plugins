import sqlite3
import unittest
from datetime import datetime, timezone

from warehouse.checkpoint import CheckpointError, CheckpointStore

NOW = datetime(2026, 3, 1, 9, 30, tzinfo=timezone.utc)


class CheckpointStoreTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.checkpoints = CheckpointStore(self.conn, clock=lambda: NOW)

    def tearDown(self):
        self.conn.close()

    def test_new_feed_starts_at_zero(self):
        self.assertEqual(self.checkpoints.load("main"), 0)
        self.assertIsNone(self.checkpoints.updated_at("main"))

    def test_save_and_load(self):
        self.checkpoints.save("main", 41)
        self.assertEqual(self.checkpoints.load("main"), 41)
        self.assertEqual(self.checkpoints.updated_at("main"), NOW)

    def test_feeds_are_separate(self):
        self.checkpoints.save("main", 41)
        self.checkpoints.save("returns", 7)
        self.assertEqual(self.checkpoints.all(), {"main": 41, "returns": 7})

    def test_cannot_move_backwards(self):
        self.checkpoints.save("main", 41)
        with self.assertRaises(CheckpointError):
            self.checkpoints.save("main", 40)
        self.assertEqual(self.checkpoints.load("main"), 41)
