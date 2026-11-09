import csv
import os

EXPORT_DIR = "/var/exports"


def export_report(rows, params):
    name = params.get("name", "report")
    path = os.path.join(EXPORT_DIR, name + ".csv")
    with open(path, "w", newline="") as f:
        csv.writer(f).writerows(rows)
    return path
