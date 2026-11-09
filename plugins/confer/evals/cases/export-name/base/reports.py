import csv
import os

EXPORT_DIR = "/var/exports"


def export_report(rows):
    path = os.path.join(EXPORT_DIR, "report.csv")
    with open(path, "w", newline="") as f:
        csv.writer(f).writerows(rows)
    return path
