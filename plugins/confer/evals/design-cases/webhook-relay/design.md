# Payment event relay

## Analysis

Paylane, our payment provider, reports payment events by sending an HTTP POST with a JSON body to a
URL we register. Today the orders service receives these events directly, and the billing service
polls the orders database for changes. Billing now needs the events as they happen, and a third
service, notifications, will need them next quarter. Each new consumer means another URL registered
with Paylane, which allows only one.

Paylane sends each event to the registered URL and sends it again when it gets no 200 response
within 10 seconds, up to five times over an hour.

## Functional requirements

1. One public endpoint, `POST /hooks/paylane`, receives every Paylane event.
2. Each event is forwarded to every internal service subscribed to its `type`.
3. Subscriptions are a static map in the relay's configuration file.
4. The relay answers Paylane with 200.

## Nonfunctional requirements

- The relay handles 50 events per second at peak, the Black Friday rate.
- Forwarding adds no more than 100 ms at the median.
- The relay runs as two instances behind the public load balancer.

## Design

The relay is a small Go service. The handler for `POST /hooks/paylane` reads the body, parses the
JSON, and reads `type`. For each subscriber of that type it sends the body unchanged in a POST to
the subscriber's internal URL, one subscriber after another, and waits for each answer. Internal
services can take up to 30 seconds to answer when their database is busy.

The relay answers Paylane with 200 once every subscriber has answered. When a subscriber answers
with an error or the request times out, the relay logs the error with the event id and still
answers 200, so that a fault in one internal service is never visible to Paylane.

The relay keeps no state. Events are not stored.

The configuration file:

```yaml
subscribers:
  payment.succeeded: [http://orders.internal/events, http://billing.internal/events]
  payment.refunded: [http://billing.internal/events]
```
