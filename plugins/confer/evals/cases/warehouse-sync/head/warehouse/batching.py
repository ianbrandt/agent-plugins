"""Splitting a sequence of movements into batches."""

from __future__ import annotations

from itertools import islice
from typing import Iterable, Iterator, TypeVar

T = TypeVar("T")


def batched(items: Iterable[T], size: int) -> Iterator[list[T]]:
    """Yield lists of up to `size` items, in order. The last list may be shorter."""
    if size < 1:
        raise ValueError(f"batch size must be at least 1: {size}")
    iterator = iter(items)
    while True:
        batch = list(islice(iterator, size))
        if not batch:
            return
        yield batch
