import unittest

from warehouse.feed import FeedUnavailable
from warehouse.retry import Retrier, RetriesExhausted, RetryPolicy


class FakeClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds

    def __call__(self):
        return self.now


def failing(times, error=None):
    calls = []

    def fn():
        calls.append(1)
        if len(calls) <= times:
            raise error or FeedUnavailable("busy")
        return "ok"

    fn.calls = calls
    return fn


class RetryPolicyTest(unittest.TestCase):
    def test_delay_doubles(self):
        policy = RetryPolicy(base_delay=0.5, jitter=0)
        self.assertEqual([policy.delay(n) for n in (1, 2, 3)], [0.5, 1.0, 2.0])

    def test_delay_is_capped(self):
        policy = RetryPolicy(base_delay=1, max_delay=5, jitter=0)
        self.assertEqual(policy.delay(10), 5)

    def test_jitter_stays_within_bounds(self):
        policy = RetryPolicy(base_delay=1, jitter=0.2)
        self.assertAlmostEqual(policy.delay(1, rand=lambda: 0.0), 0.8)
        self.assertAlmostEqual(policy.delay(1, rand=lambda: 1.0), 1.2)


class RetrierTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()

    def retrier(self, **options):
        policy = RetryPolicy(**{"attempts": 4, "base_delay": 1, "jitter": 0, **options})
        return Retrier(policy, sleep=self.clock.sleep, clock=self.clock)

    def test_success_needs_no_wait(self):
        self.assertEqual(self.retrier().call(lambda: "ok"), "ok")
        self.assertEqual(self.clock.sleeps, [])

    def test_retries_transient_errors_until_success(self):
        fn = failing(2)
        retrier = self.retrier()
        self.assertEqual(retrier.call(fn), "ok")
        self.assertEqual(self.clock.sleeps, [1, 2])
        self.assertEqual(retrier.stats.retries, 2)

    def test_gives_up_after_the_last_attempt(self):
        fn = failing(10)
        with self.assertRaises(RetriesExhausted) as caught:
            self.retrier().call(fn)
        self.assertEqual(caught.exception.attempts, 4)
        self.assertEqual(len(fn.calls), 4)
        self.assertIsInstance(caught.exception.last_error, FeedUnavailable)

    def test_deadline_stops_early(self):
        retrier = Retrier(RetryPolicy(attempts=10, base_delay=1, jitter=0), sleep=self.clock.sleep, clock=self.clock, deadline=5)
        with self.assertRaises(RetriesExhausted):
            retrier.call(failing(10))
        self.assertEqual(self.clock.sleeps, [1, 2])

    def test_server_retry_after_does_not_shorten_the_wait(self):
        error = FeedUnavailable("busy", retry_after_ms=0)
        self.assertEqual(self.retrier().wait_after(2, error), 2)
