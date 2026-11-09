import logging

from billing.payments_client import PaymentsClient

log = logging.getLogger(__name__)


def capture_pending(orders, client: PaymentsClient):
    """Captures each order's authorized payment once it has shipped."""
    for order in orders.shipped_awaiting_capture():
        try:
            client.capture(order.payment_id, order.total_cents)
        except Exception:
            log.exception("capture failed for order %s", order.id)
            orders.mark_capture_failed(order.id)
            continue
        orders.mark_captured(order.id)
