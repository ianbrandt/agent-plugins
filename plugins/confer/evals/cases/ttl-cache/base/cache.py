class Cache:
    """Keeps the most recently written entries."""

    def __init__(self, size):
        self._size = size
        self._data = {}
        self._order = []

    def put(self, key, value):
        if key not in self._data:
            self._order.append(key)
        self._data[key] = value
        if len(self._order) > self._size:
            oldest = self._order.pop(0)
            del self._data[oldest]

    def get(self, key):
        return self._data.get(key)
