"""Domain types for stock movements and levels."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

KINDS = ("receive", "pick", "adjust")


@dataclass(frozen=True)
class Movement:
    """One change to the stock of a SKU at a location, as reported by the warehouse.

    `quantity` is positive for receipts and picks. An adjustment carries its own sign.
    """

    seq: int
    sku: str
    location: str
    kind: str
    quantity: int
    occurred_at: datetime
    reference: str = ""

    def __post_init__(self):
        if self.kind not in KINDS:
            raise ValueError(f"unknown movement kind: {self.kind!r}")
        if self.kind != "adjust" and self.quantity <= 0:
            raise ValueError(f"{self.kind} quantity must be positive: {self.quantity}")
        if not self.sku or not self.location:
            raise ValueError("sku and location are required")

    @property
    def delta(self) -> int:
        """The change to on-hand stock: negative for picks."""
        return -self.quantity if self.kind == "pick" else self.quantity


@dataclass(frozen=True)
class StockLevel:
    sku: str
    location: str
    on_hand: int
