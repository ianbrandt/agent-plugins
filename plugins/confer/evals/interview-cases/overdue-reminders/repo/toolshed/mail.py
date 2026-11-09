import smtplib
from email.message import EmailMessage

RELAY = "relay.example.invalid"


def send_email(to, subject, body):
    """Sends one message through the library's relay.

    The relay accepts at most 50 messages an hour from us and rejects the rest with a 451.
    """
    msg = EmailMessage()
    msg["From"] = "desk@toolshed.example.invalid"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(RELAY) as s:
        s.send_message(msg)
