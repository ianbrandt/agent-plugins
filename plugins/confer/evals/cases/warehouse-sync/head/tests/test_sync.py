import os
import tempfile
import unittest

from warehouse.checkpoint import CheckpointStore
from warehouse.deadletter import DeadLetterFile
from warehouse.feed import FeedUnavailable, page_from_records
from warehouse.retry import Retrier, RetryPolicy
from warehouse.store import Store
from warehouse.sync import SyncService


def record(seq, kind="receive", qty=5, sku="A100"):
    return {"seq": seq, "sku": sku, "loc": "BIN-1", "kind": kind, "qty": qty, "at": "2026-03-01T09:00:00"}


class ListFeed:
    """A feed over a list of records, which can be made to fail."""

    name = "main"

    def __init__(self, records, failures=0):
        self.records = list(records)
        self.failures = failures
        self.requests = []

    def fetch(self, after, limit):
        self.requests.append((after, limit))
        if self.failures:
            self.failures -= 1
            raise FeedUnavailable("busy")
        return page_from_records(self.records, after, limit)


class StopAfter:
    """Stands in for a threading.Event: records each wait and sets itself after `runs` of them."""

    def __init__(self, runs):
        self.runs = runs
        self.waits = []

    def is_set(self):
        return len(self.waits) >= self.runs

    def wait(self, timeout):
        self.waits.append(timeout)
        return self.is_set()


class SyncServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store()
        self.checkpoints = CheckpointStore(self.store.connection)
        self.sleeps = []
        self.dead = DeadLetterFile(os.path.join(self.tmp.name, "rejects.jsonl"))

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def service(self, feed, **options):
        retrier = Retrier(RetryPolicy(attempts=3, base_delay=0.1, jitter=0), sleep=self.sleeps.append)
        options = {"page_size": 4, "batch_size": 2, **options}
        return SyncService(feed, self.store, self.checkpoints, dead_letters=self.dead, retrier=retrier, **options)

    def test_applies_every_page(self):
        feed = ListFeed([record(n) for n in range(1, 11)])
        result = self.service(feed).run_once()
        self.assertEqual((result.pages, result.fetched, result.applied), (3, 10, 10))
        self.assertEqual(self.store.on_hand("A100", "BIN-1"), 50)
        self.assertEqual(self.checkpoints.load("main"), 10)
        self.assertEqual([after for after, _ in feed.requests], [0, 4, 8])

    def test_resumes_from_the_checkpoint(self):
        feed = ListFeed([record(n) for n in range(1, 4)])
        self.service(feed).run_once()
        feed.records += [record(4, "pick", 2), record(5, "pick", 1)]
        result = self.service(feed).run_once()
        self.assertEqual(result.applied, 2)
        self.assertEqual(self.store.on_hand("A100", "BIN-1"), 12)
        self.assertEqual([after for after, _ in feed.requests], [0, 3])

    def test_rejected_records_go_to_the_dead_letter_file(self):
        feed = ListFeed([record(1), record(2, kind="teleport"), record(3)])
        result = self.service(feed).run_once()
        self.assertEqual((result.applied, result.rejected), (2, 1))
        self.assertEqual([entry["seq"] for entry in self.dead.read()], [2])
        self.assertEqual(self.checkpoints.load("main"), 3)

    def test_retries_while_the_feed_is_busy(self):
        feed = ListFeed([record(1)], failures=2)
        result = self.service(feed).run_once()
        self.assertEqual(result.applied, 1)
        self.assertEqual(len(self.sleeps), 2)

    def test_run_after_a_stop_before_the_checkpoint_skips_applied_movements(self):
        feed = ListFeed([record(n) for n in range(1, 5)])
        self.store.apply_batch(page_from_records(feed.records, 0, 4).movements)
        result = self.service(feed).run_once()
        self.assertEqual((result.applied, result.duplicates), (0, 4))
        self.assertEqual(self.store.on_hand("A100", "BIN-1"), 20)
        self.assertEqual(self.checkpoints.load("main"), 4)


class RunForeverTest(unittest.TestCase):
    def setUp(self):
        self.store = Store()
        self.checkpoints = CheckpointStore(self.store.connection)

    def tearDown(self):
        self.store.close()

    def test_idle_feed_is_polled_less_often(self):
        service = SyncService(ListFeed([]), self.store, self.checkpoints)
        stop = StopAfter(4)
        service.run_forever(stop, poll_interval=30, max_poll_interval=200)
        self.assertEqual(stop.waits, [60, 120, 200, 200])

    def test_busy_feed_is_polled_at_the_interval(self):
        feed = ListFeed([record(1), record(2)])
        results = []
        service = SyncService(feed, self.store, self.checkpoints)
        stop = StopAfter(2)
        service.run_forever(stop, poll_interval=30, on_result=results.append)
        self.assertEqual(stop.waits[0], 30)
        self.assertEqual(results[0].applied, 2)
