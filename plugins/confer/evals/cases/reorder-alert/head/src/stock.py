class Item:
    def __init__(self, name, qty, level):
        self.name = name
        self.qty = qty
        self.level = level


def total_units(items):
    return sum(item.qty for item in items)


def low_stock(items):
    return [item.name for item in items if item.qty < item.level]
