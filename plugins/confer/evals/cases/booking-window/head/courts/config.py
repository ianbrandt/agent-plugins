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

# Booking for a slot opens at OPENS_AT, club time, this many days before the
# slot's date.
ADVANCE_DAYS = {"full": 7, "social": 3, "junior": 3}
OPENS_AT = time(7, 0)

# The longest single booking, and the most court time a member can book on
# one day, in minutes.
MAX_MINUTES = 90
DAILY_MINUTES = 120
