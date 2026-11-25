# warehouse

Keeps a local record of stock on hand per SKU and location, built from the movement export of the
warehouse management system.

    python3 -m warehouse.cli --db stock.db import movements.jsonl
    python3 -m warehouse.cli --db stock.db levels

Each line of an export is one JSON movement:

    {"seq": 41, "sku": "A100", "loc": "BIN-1", "kind": "pick", "qty": 3, "at": "2026-03-01T09:00:00", "ref": "SO-881"}

Run the tests with `python3 -m unittest`.
