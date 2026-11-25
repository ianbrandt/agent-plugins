import unittest

from warehouse.batching import batched


class BatchedTest(unittest.TestCase):
    def test_even_split(self):
        self.assertEqual(list(batched(range(6), 3)), [[0, 1, 2], [3, 4, 5]])

    def test_last_batch_shorter(self):
        self.assertEqual(list(batched(range(5), 2)), [[0, 1], [2, 3], [4]])

    def test_empty(self):
        self.assertEqual(list(batched([], 4)), [])

    def test_size_must_be_positive(self):
        with self.assertRaises(ValueError):
            list(batched([1], 0))
