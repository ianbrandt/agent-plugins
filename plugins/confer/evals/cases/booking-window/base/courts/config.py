"""Club settings."""

from datetime import time
from zoneinfo import ZoneInfo

CLUB_TZ = ZoneInfo("Australia/Sydney")

# Courts are booked in slots of SLOT_MINUTES, the first starting at FIRST_SLOT
# and the last at LAST_SLOT, club time.
SLOT_MINUTES = 30
FIRST_SLOT = time(6, 0)
LAST_SLOT = time(21, 30)

# A booking can be cancelled until this many hours before it starts.
CANCEL_NOTICE_HOURS = 24

TIERS = ("full", "social", "junior")
