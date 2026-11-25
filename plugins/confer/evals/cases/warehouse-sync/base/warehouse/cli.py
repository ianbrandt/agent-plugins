"""Command line for the stock store."""

from __future__ import annotations

import argparse
import sys
from datetime import datetime

from .feed import FeedError, read_movements
from .reports import format_totals, movement_totals, stock_report
from .store import Store


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="warehouse")
    parser.add_argument("--db", default="stock.db", help="SQLite database file")
    sub = parser.add_subparsers(dest="command", required=True)
    imp = sub.add_parser("import", help="apply every movement in an export file")
    imp.add_argument("file")
    sub.add_parser("levels", help="print stock on hand")
    totals = sub.add_parser("totals", help="print quantities moved per kind")
    totals.add_argument("--since", type=datetime.fromisoformat)
    return parser


def main(argv: list[str] | None = None, out=None) -> int:
    out = out or sys.stdout
    args = build_parser().parse_args(argv)
    with Store(args.db) as store:
        if args.command == "import":
            try:
                movements = read_movements(args.file)
            except (OSError, FeedError) as exc:
                print(f"error: {exc}", file=sys.stderr)
                return 1
            new = [m for m in movements if not store.has_seq(m.seq)]
            for movement in new:
                store.apply(movement)
            print(f"imported {len(new)} movements ({len(movements) - len(new)} already present)", file=out)
        elif args.command == "levels":
            print(stock_report(store.levels()), file=out)
        elif args.command == "totals":
            print(format_totals(movement_totals(store.movements(args.since)), args.since), file=out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
