# Allo Inventory Reservations

Focused implementation of a multi-warehouse stock reservation flow for checkout. The app uses Next.js App Router, TypeScript, Prisma, and Postgres.

## What is included

- Product and warehouse inventory with `totalUnits`, `reservedUnits`, and computed availability.
- Pending, confirmed, and released reservations with an `expiresAt` deadline.
- API routes for products, warehouses, reserve, confirm, release, and expiry cleanup.
- A small frontend for reserving one unit, viewing the checkout countdown, confirming, and cancelling.
- Idempotency support for `POST /api/reservations` and `POST /api/reservations/:id/confirm`.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env`:

   ```bash
   cp .env.example .env
   ```

   Set `DATABASE_URL` to a hosted Postgres database, for example Supabase or Neon. The schema is Postgres-specific by design.

3. Run migrations and seed data:

   ```bash
   npm run prisma:deploy
   npm run seed
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

5. Optional concurrency smoke test:

   ```bash
   npm run test:concurrency
   ```

   The smoke test sets one seeded SKU/location to exactly one available unit, fires eight concurrent reservation attempts, and expects one success plus seven `409` failures.

## API behavior

- `GET /api/products` returns products with per-warehouse total, reserved, and available units.
- `GET /api/warehouses` returns warehouses.
- `POST /api/reservations` reserves units and returns `409` when availability is insufficient.
- `GET /api/reservations/:id` returns reservation details for the checkout page.
- `POST /api/reservations/:id/confirm` confirms a pending reservation and returns `410` if it expired first.
- `POST /api/reservations/:id/release` releases a pending reservation early.
- `POST /api/cron/release-expired` releases expired pending holds. In production this is configured in `vercel.json` to run every five minutes.

## Concurrency approach

The core reservation operation is a single guarded SQL update inside a Prisma transaction:

```sql
UPDATE "StockLevel"
SET "reservedUnits" = "reservedUnits" + quantity
WHERE "productId" = productId
  AND "warehouseId" = warehouseId
  AND ("totalUnits" - "reservedUnits") >= quantity
```

Postgres takes a row lock for the update. If two requests race for the last unit, one transaction updates the row first. The second transaction rechecks the `WHERE` condition against the committed row version and updates zero rows, so the API returns `409`.

Confirming a reservation decrements both `totalUnits` and `reservedUnits`. Releasing decrements only `reservedUnits`. Both paths first move the reservation out of `PENDING` with a conditional status update, so a reservation cannot be released or confirmed twice.

## Expiry approach

The app uses both lazy cleanup and a cron endpoint:

- Lazy cleanup runs before product reads and new reservation attempts, so expired pending holds do not keep inventory unavailable during normal traffic.
- `POST /api/cron/release-expired` releases batches of expired holds for production. `vercel.json` schedules it every five minutes. Set `CRON_SECRET` in production and call the endpoint with `Authorization: Bearer <secret>`.

## Idempotency

`POST /api/reservations` and `POST /api/reservations/:id/confirm` accept an `Idempotency-Key` header. The server creates a unique record for `(key, method, path)`. Retries with the same key return the stored response instead of repeating the side effect. If an identical request is still running, the second request briefly waits for the stored result and then returns `409` if it is still in progress.

## Trade-offs

- The frontend reserves one unit at a time to keep the exercise focused. The API supports larger quantities.
- Expiry cleanup processes 100 reservations per transaction. A production worker would loop until no expired rows remain and emit metrics.
- This uses Postgres transactions rather than Redis locks. For this data model, the inventory row is the lock, which keeps the correctness boundary close to the data being protected.
- The live deployment still needs a hosted Postgres URL and seeded data. No local SQLite fallback is included because the exercise specifically asks for hosted Postgres.
