from datetime import datetime

from .loans import LIBRARY_TZ, load_loans


def main():
    today = datetime.now(LIBRARY_TZ).date()
    late = [l for l in load_loans() if not l.returned and l.due < today]
    print(f"{len(late)} loans are overdue")


if __name__ == "__main__":
    main()
