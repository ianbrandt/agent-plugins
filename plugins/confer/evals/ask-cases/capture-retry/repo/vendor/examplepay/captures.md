# Captures

Copied from the ExamplePay API reference, v1.

## POST /v1/payments/{id}/capture

Captures funds from an authorized payment. A payment can be captured more than once, up to the
authorized amount, so a shipment sent in parts can be charged as each part ships.

Body:

- `amount`: the amount to capture, in cents.

Headers:

- `Authorization`: `Bearer <key>`.
- `Idempotency-Key` (optional): any unique string. A request with a key that was used in the last
  24 hours is applied once, and every later request with that key returns the first result.
  A request with no key is applied as a new capture each time it is received.

Responses:

- `200`: the capture, with its `id` and `amount`.
- `402`: the authorization was declined or has expired.
- `409`: the capture would exceed the authorized amount.
