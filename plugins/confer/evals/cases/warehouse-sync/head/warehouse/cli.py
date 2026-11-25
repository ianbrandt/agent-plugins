"""Command line for the stock store."""

from __future__ import annotations

import argparse
import logging
import signal
import sys
import threading
from datetime import datetime, timezone

from .checkpoint import CheckpointStore
from .config import ConfigError, SyncConfig, load_config
from .deadletter import DeadLetterFile
from .feed import FeedError, read_movements
from .reconcile import CountFileError, apply_corrections, format_reconciliation, read_counts, reconcile
from .reports import (
    FeedStatus,
    format_net_change,
    format_sync_status,
    format_totals,
    movement_totals,
    net_change,
    stock_report,
    write_net_change_csv,
)
from .retry import RetriesExhausted
from .store import Store
from .sync import SyncService


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="warehouse")
    parser.add_argument("--db", help="SQLite database file (default: db_path from the config, or stock.db)")
    parser.add_argument("--config", help="INI file with a [sync] section")
    parser.add_argument("-v", "--verbose", action="store_true", help="log each sync step")
    sub = parser.add_subparsers(dest="command", required=True)
    imp = sub.add_parser("import", help="apply every movement in an export file")
    imp.add_argument("file")
    sub.add_parser("levels", help="print stock on hand")
    totals = sub.add_parser("totals", help="print quantities moved per kind")
    totals.add_argument("--since", type=datetime.fromisoformat)
    sub.add_parser("sync", help="apply the movements after the checkpoint, once")
    sub.add_parser("watch", help="sync repeatedly until interrupted")
    sub.add_parser("status", help="print each feed's checkpoint and dead letters")
    rec = sub.add_parser("reconcile", help="compare stock with a cycle count CSV")
    rec.add_argument("counts")
    rec.add_argument("--tolerance", type=int, default=0, help="units either way that still count as a match")
    rec.add_argument("--apply", action="store_true", help="correct stored levels to the counted quantities")
    change = sub.add_parser("net-change", help="print the net change per SKU and location")
    change.add_argument("--since", type=datetime.fromisoformat)
    change.add_argument("--csv", help="write CSV to this file instead")
    return parser


def _sync_config(args) -> SyncConfig:
    return load_config(args.config)


def _cmd_import(store: Store, args, out) -> int:
    try:
        movements = read_movements(args.file)
    except (OSError, FeedError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    new = [m for m in movements if not store.has_seq(m.seq)]
    for movement in new:
        store.apply(movement)
    print(f"imported {len(new)} movements ({len(movements) - len(new)} already present)", file=out)
    return 0


def _cmd_sync(store: Store, args, out) -> int:
    service = SyncService.from_config(_sync_config(args), store)
    try:
        result = service.run_once()
    except RetriesExhausted as exc:
        print(f"error: feed unavailable: {exc}", file=sys.stderr)
        return 2
    except FeedError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(result.describe(), file=out)
    return 0


def _cmd_watch(store: Store, args, out) -> int:
    config = _sync_config(args)
    service = SyncService.from_config(config, store)
    stop = threading.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: stop.set())
    service.run_forever(
        stop,
        poll_interval=config.poll_interval,
        max_poll_interval=config.max_poll_interval,
        on_result=lambda result: print(result.describe(), file=out, flush=True),
    )
    return 0


def _cmd_status(store: Store, args, out) -> int:
    checkpoints = CheckpointStore(store.connection)
    dead_letters = None
    if args.config:
        config = _sync_config(args)
        if config.dead_letter_path:
            dead_letters = DeadLetterFile(config.dead_letter_path)
    statuses = [
        FeedStatus(feed, seq, checkpoints.updated_at(feed), dead_letters.count(feed) if dead_letters else 0)
        for feed, seq in checkpoints.all().items()
    ]
    print(format_sync_status(statuses, datetime.now(timezone.utc)), file=out)
    return 0


def _cmd_reconcile(store: Store, args, out) -> int:
    try:
        counts = read_counts(args.counts)
    except (OSError, CountFileError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    result = reconcile(store.levels(), counts, tolerance=args.tolerance)
    print(format_reconciliation(result), file=out)
    if args.apply and not result.clean:
        changed = apply_corrections(store, result, reference=args.counts)
        print(f"corrected {changed} levels", file=out)
    return 0 if result.clean or args.apply else 3


def _cmd_net_change(store: Store, args, out) -> int:
    movements = store.movements(args.since)
    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            rows = write_net_change_csv(movements, fh)
        print(f"wrote {rows} rows to {args.csv}", file=out)
    else:
        print(format_net_change(net_change(movements), args.since), file=out)
    return 0


COMMANDS = {
    "import": _cmd_import,
    "sync": _cmd_sync,
    "watch": _cmd_watch,
    "status": _cmd_status,
    "reconcile": _cmd_reconcile,
    "net-change": _cmd_net_change,
}


def main(argv: list[str] | None = None, out=None) -> int:
    out = out or sys.stdout
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(levelname)s %(message)s")
    try:
        db = args.db or (_sync_config(args).db_path if args.config else "stock.db")
    except ConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    with Store(db) as store:
        if args.command == "levels":
            print(stock_report(store.levels()), file=out)
            return 0
        if args.command == "totals":
            print(format_totals(movement_totals(store.movements(args.since)), args.since), file=out)
            return 0
        try:
            return COMMANDS[args.command](store, args, out)
        except ConfigError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1


if __name__ == "__main__":
    sys.exit(main())
