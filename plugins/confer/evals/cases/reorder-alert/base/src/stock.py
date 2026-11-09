class Item:
    def __init__(self, name, qty, level):
        self.name = name
        self.qty = qty
        self.level = level


def total_units(items):
    return sum(item.qty for item in items)
