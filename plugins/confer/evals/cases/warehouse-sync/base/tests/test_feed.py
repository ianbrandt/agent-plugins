import json
import os
import tempfile
import unittest

from warehouse.feed import FeedError, parse_movement, read_movements


def record(seq, kind="receive", qty=5, **extra):
    return {"seq": seq, "sku": "A100", "loc": "BIN-1", "kind": kind, "qty": qty, "at": "2026-03-01T09:00:00", **extra}


class ParseTest(unittest.TestCase):
    def test_parses_fields(self):
        movement = parse_movement(record(7, "pick", 2, ref="SO-1"))
        self.assertEqual((movement.seq, movement.kind, movement.quantity, movement.reference), (7, "pick", 2, "SO-1"))

    def test_missing_field(self):
        bad = record(1)
        del bad["loc"]
        with self.assertRaises(FeedError):
            parse_movement(bad)

    def test_unknown_kind(self):
        with self.assertRaises(FeedError):
            parse_movement(record(1, kind="teleport"))


class ReadTest(unittest.TestCase):
    def test_reads_every_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "export.jsonl")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(json.dumps(record(1)) + "\n\n" + json.dumps(record(2, "pick", 1)) + "\n")
            self.assertEqual([m.seq for m in read_movements(path)], [1, 2])
