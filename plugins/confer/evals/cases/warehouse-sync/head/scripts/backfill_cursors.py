"""Seed the sync checkpoint of a database that was filled with `warehouse import`.

A database built from export files has movements but no checkpoint, so its first incremental
sync would fetch the whole feed again. This script sets the feed's checkpoint to the last
sequence number already applied, so that sync resumes with the movement after it.

    python3 scripts/backfill_cursors.py --db stock.db --feed main
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from warehouse.checkpoint import CheckpointStore  # noqa: E402
from warehouse.store import Store  # noqa: E402


def backfill(store: Store, feed: str, *, force: bool = False) -> int | None:
    """Seed the checkpoint and return it, or None when there was nothing to do."""
    checkpoints = CheckpointStore(store.connection)
    existing = checkpoints.load(feed)
    if existing and not force:
        print(f"{feed}: already at checkpoint {existing}; use --force to replace it", file=sys.stderr)
        return None
    last = store.last_seq()
    if last is None:
        print(f"{feed}: no movements in the database; nothing to seed", file=sys.stderr)
        return None
    checkpoint = last + 1
    if force and checkpoint < existing:
        checkpoints.reset(feed)
    checkpoints.save(feed, checkpoint)
    return checkpoint


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", required=True, help="SQLite database file")
    parser.add_argument("--feed", default="main", help="feed name, as in the sync config")
    parser.add_argument("--force", action="store_true", help="replace an existing checkpoint")
    parser.add_argument("--dry-run", action="store_true", help="print what would be done")
    args = parser.parse_args(argv)
    if not Path(args.db).exists():
        print(f"error: {args.db} does not exist", file=sys.stderr)
        return 1
    with Store(args.db) as store:
        if args.dry_run:
            print(f"{args.feed}: last applied seq {store.last_seq()}, checkpoint {CheckpointStore(store.connection).load(args.feed)}")
            return 0
        checkpoint = backfill(store, args.feed, force=args.force)
    if checkpoint is not None:
        print(f"{args.feed}: checkpoint set to {checkpoint}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
