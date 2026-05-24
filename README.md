# Allo Inventory Reservations

Next.js App Router implementation of a checkout reservation system for multi-warehouse inventory. The core reservation path uses a single conditional Postgres `UPDATE` inside a serializable transaction, so concurrent requests for the final available unit cannot both succeed.

## What is included

- Products, warehouses, stock levels, reservations, and idempotency records in Prisma/Postgres.
- `GET /api/products` and `GET /api/warehouses`.
- `POST /api/reservations`, `POST /api/reservations/:id/confirm`, and `POST /api/reservations/:id/release`.
- User-visible `409` stock errors and `410` expired reservation errors.
- Reservation checkout UI with live countdown, confirm, cancel, and automatic product refresh.
- Idempotency for reserve and confirm via the `Idempotency-Key` header.

## Run locally

Use a hosted Postgres database, such as Supabase, Neon, or Railway. SQLite/local-only databases are intentionally not used because the exercise asks for a real hosted data layer.

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to your hosted Postgres connection string.
3. Install dependencies:

```bash
npm install
```

4. Create tables and seed demo data:

```bash
npm run prisma:migrate -- --name init
npm run prisma:seed
```

5. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Concurrency approach

The reservation endpoint does not read available stock and then write later. It performs one atomic statement:

```sql
UPDATE "StockLevel"
SET "reservedUnits" = "reservedUnits" + $quantity
WHERE "productId" = $productId
  AND "warehouseId" = $warehouseId
  AND ("totalUnits" - "reservedUnits") >= $quantity
RETURNING "id";
```

Postgres locks the updated row. If two checkout requests race for the last unit, one transaction updates the row and the other re-checks the predicate after the first commit; the second request returns `409`.

Confirming a reservation permanently decrements `totalUnits` and removes the held units from `reservedUnits`. Releasing a reservation only decrements `reservedUnits`.

## Expiry approach

Reservations expire after 10 minutes. Expiry is handled in two ways:

- Lazy cleanup runs before reads and reservation mutations, releasing any pending reservations whose `expiresAt` is in the past.
- `POST /api/cron/expire-reservations` can be called by Vercel Cron or another scheduler. If `CRON_SECRET` is set, send `Authorization: Bearer <secret>`.

The cleanup query releases expired reservations and returns the reserved units to stock in one transaction.

## Idempotency

`POST /api/reservations` and `POST /api/reservations/:id/confirm` support `Idempotency-Key`. The server stores the original status code and JSON response for each key/scope pair for 24 hours. A retry with the same key and same request body returns the original response without repeating the side effect. A retry with the same key but a different body returns `409`.

To keep concurrent retries correct, the idempotency path takes a transaction-scoped Postgres advisory lock for the key before checking or writing the idempotency record.

## Production notes and trade-offs

- This implementation assumes one Postgres primary. For a high-throughput production version, I would add focused load tests around the reservation query and tune indexes from observed query plans.
- The app uses lazy cleanup plus an optional cron endpoint instead of a separate worker to keep deployment small.
- Idempotency records are retained for 24 hours. A production cleanup job should delete expired records.
- Authentication and tenant boundaries are omitted for the take-home scope, but the data model is ready to add merchant/store ownership.
