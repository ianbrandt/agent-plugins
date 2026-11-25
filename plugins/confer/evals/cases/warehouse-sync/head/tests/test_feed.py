import io
import json
import os
import tempfile
import unittest
import urllib.error

from warehouse.feed import (
    FeedError,
    FeedUnavailable,
    FileFeed,
    HttpFeed,
    page_from_records,
    parse_movement,
    read_movements,
)


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


class PageTest(unittest.TestCase):
    def test_keeps_records_after_the_checkpoint_in_order(self):
        page = page_from_records([record(3), record(1), record(2)], after=1, limit=10)
        self.assertEqual([m.seq for m in page.movements], [2, 3])
        self.assertEqual(page.last_seq, 3)

    def test_bad_record_is_rejected_not_raised(self):
        page = page_from_records([record(1), record(2, qty=-4), record(3)], after=0, limit=10)
        self.assertEqual([m.seq for m in page.movements], [1, 3])
        self.assertEqual([r.seq for r in page.rejected], [2])
        self.assertIn("positive", page.rejected[0].reason)

    def test_rejects_count_toward_the_limit_and_last_seq(self):
        page = page_from_records([record(1), record(2, kind="teleport")], after=0, limit=2)
        self.assertEqual(len(page), 2)
        self.assertEqual(page.last_seq, 2)


class FileFeedTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "export.jsonl")

    def tearDown(self):
        self.tmp.cleanup()

    def test_fetch_after(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("".join(json.dumps(record(n)) + "\n" for n in range(1, 5)))
        page = FileFeed(self.path).fetch(after=2, limit=10)
        self.assertEqual([m.seq for m in page.movements], [3, 4])

    def test_line_still_being_written_is_left_for_later(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(record(1)) + "\n" + json.dumps(record(2))[:20])
        page = FileFeed(self.path).fetch(after=0, limit=10)
        self.assertEqual([m.seq for m in page.movements], [1])

    def test_missing_file_is_unavailable(self):
        with self.assertRaises(FeedUnavailable):
            FileFeed(self.path).fetch(after=0, limit=10)


class FakeOpener:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.urls = []

    def __call__(self, url, timeout):
        self.urls.append(url)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return io.BytesIO(json.dumps(response).encode())


def http_error(code, headers=None):
    return urllib.error.HTTPError("http://wms.example/feed", code, "error", headers or {}, None)


class HttpFeedTest(unittest.TestCase):
    def test_fetch_sends_after_and_limit(self):
        opener = FakeOpener({"movements": [record(5), record(6)]})
        page = HttpFeed("http://wms.example/feed", opener=opener).fetch(after=4, limit=2)
        self.assertEqual([m.seq for m in page.movements], [5, 6])
        self.assertEqual(opener.urls, ["http://wms.example/feed?after=4&limit=2"])

    def test_busy_server_is_unavailable_with_its_retry_after(self):
        opener = FakeOpener(http_error(503, {"Retry-After": "2"}))
        with self.assertRaises(FeedUnavailable) as caught:
            HttpFeed("http://wms.example/feed", opener=opener).fetch(after=0, limit=10)
        self.assertEqual(caught.exception.retry_after_ms, 2000)
