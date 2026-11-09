import csv
from dataclasses import dataclass


@dataclass
class Member:
    id: str
    name: str
    email: str
    phone: str
    # "email", "sms", or "none": how the member agreed to be contacted.
    contact: str


def load_members(path="data/members.csv"):
    with open(path, newline="") as f:
        return {r["id"]: Member(r["id"], r["name"], r["email"], r["phone"], r["contact"]) for r in csv.DictReader(f)}
