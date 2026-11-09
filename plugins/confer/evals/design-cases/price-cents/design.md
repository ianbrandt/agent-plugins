# Store prices in cents

## Analysis

The catalog service stores each product's price in `products.price_dollars`, a `REAL` column. Totals
at checkout are summed from these values, and customers have seen totals one cent off, such as
`19.989999` shown as `19.98`. The payment gateway takes amounts in cents as integers.

The catalog service is a Python app on PostgreSQL 16, deployed to six instances. A deploy replaces
the instances one at a time over about 15 minutes. The `products` table has 4 million rows, and
prices are edited by the merchandising team all day through the admin screens.

## Functional requirements

1. Prices are stored as whole cents in an `INTEGER` column, `price_cents`.
2. Checkout totals are summed in cents and sent to the gateway unchanged.
3. The admin screens show and accept prices in dollars, as now.

## Nonfunctional requirements

- The change ships in one release.
- Catalog reads stay under 20 ms at the 99th percentile during the change.

## Design

One migration, run by the deploy before the new code starts:

```sql
ALTER TABLE products ADD COLUMN price_cents INTEGER;
UPDATE products SET price_cents = CAST(TRUNC(price_dollars * 100) AS INTEGER);
ALTER TABLE products ALTER COLUMN price_cents SET NOT NULL;
ALTER TABLE products DROP COLUMN price_dollars;
```

The new code reads and writes `price_cents` only. The admin screens save the entered dollar amount
as `int(dollars * 100)`, and divide by 100 to show it. The checkout sums `price_cents` and
passes the total to the gateway.

The migration runs in a single transaction, so either every row moves or none does.
