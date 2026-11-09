from src.stock import Item, low_stock


def test_low_stock_lists_items_below_their_level():
    items = [Item("bolt", 2, 10), Item("nut", 50, 10)]
    assert low_stock(items) == ["bolt"]
