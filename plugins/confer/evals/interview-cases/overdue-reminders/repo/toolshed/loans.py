import csv
from dataclasses import dataclass
from datetime import date
from zoneinfo import ZoneInfo

# Due dates are calendar days at the library, which closes at 18:00 local time.
LIBRARY_TZ = ZoneInfo("America/Denver")


@dataclass
class Loan:
    member_id: str
    tool: str
    due: date
    returned: bool


def load_loans(path="data/loans.csv"):
    with open(path, newline="") as f:
        return [
            Loan(r["member_id"], r["tool"], date.fromisoformat(r["due"]), r["returned"] == "yes")
            for r in csv.DictReader(f)
        ]
