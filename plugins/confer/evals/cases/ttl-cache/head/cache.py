import time


class Cache:
    """Keeps the most recently written entries.

    ttl is how long an entry lives, in milliseconds.
    """

    def __init__(self, size, ttl):
        self._size = size
        self._ttl = ttl
        self._data = {}
        self._expires = {}
        self._order = []

    def put(self, key, value):
        if key not in self._data:
            self._order.append(key)
        self._data[key] = value
        self._expires[key] = time.monotonic() + self._ttl
        if len(self._order) > self._size:
            oldest = self._order.pop(0)
            del self._data[oldest]
            del self._expires[oldest]

    def get(self, key):
        if key in self._data and time.monotonic() >= self._expires[key]:
            del self._data[key]
            del self._expires[key]
            return None
        return self._data.get(key)
