from cache import Cache


def test_an_entry_expires():
    cache = Cache(2, 0)
    cache.put("a", 1)
    assert cache.get("a") is None


def test_the_oldest_entry_is_evicted():
    cache = Cache(2, 60000)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("c", 3)
    assert cache.get("a") is None
    assert cache.get("c") == 3
