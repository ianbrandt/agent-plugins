# courts

Court bookings for a tennis club. Members book courts in 30-minute slots from the booking sheet, and
the club's rules on who can book what are checked in `courts.booking`.

Times are stored in UTC and shown in club time, which is set by `CLUB_TZ` in `courts/config.py`.

Run the tests with `python3 -m unittest`.
