# Allo Inventory Reservations

A multi-warehouse stock reservation system that prevents overselling during checkout. When customers proceed to payment, units are temporarily held for 10 minutes. If payment succeeds, the hold becomes permanent. If payment fails or time expires, units return to available inventory.

**Tech**: Next.js 15, TypeScript, Prisma, PostgreSQL

## What is included

- Product and warehouse inventory with `totalUnits`, `reservedUnits`, and computed availability.
- Pending, confirmed, and released reservations with an `expiresAt` deadline.
- API routes for products, warehouses, reserve, confirm, release, and expiry cleanup.
- Frontend for searching products, reserving units, viewing checkout countdown, and confirming/cancelling orders.
- Idempotency support for `POST /api/reservations` and `POST /api/reservations/:id/confirm`.
- Concurrency smoke test to verify race condition handling.

## Frontend

- **Product Listing** (`/`): Browse products by warehouse with stock levels. Click "Reserve" to hold a unit.
- **Checkout** (`/reservations/:id`): See countdown timer, product details, and warehouse info. Confirm purchase or cancel. Success popup appears after confirming, then redirects back to inventory.
- **Error Handling**: 409 (insufficient stock) and 410 (expired) errors shown to users.

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

## Vercel Deployment

1. Push to GitHub: `git push origin main`
2. Go to [vercel.com](https://allo-inventory-reservation-2.vercel.app/) → Add Project → import your repo
3. Set environment variables: `DATABASE_URL`, `DIRECT_URL`, `CRON_SECRET`, etc.
4. Deploy
5. Run: `npm run prisma:deploy && npm run seed`

**Note**: Free tier doesn't support frequent cron. Lazy cleanup handles expiry during active traffic.

## Trade-offs

- **One unit at a time**: Frontend reserves 1 unit per click to keep it simple. API supports bulk quantities.
- **Batch cleanup**: Processes 100 expired reservations per transaction. Could scale with background workers.
- **Postgres locking**: Uses row-level locks instead of Redis. Works well for this data model since inventory rows are the source of truth.
- **No SQLite**: Uses hosted Postgres as required. No local fallback for demo purposes.

## Future improvements

- Multi-unit cart (allow reserving 2, 5, 10 units)
- Admin dashboard for reservation analytics
- Payment integration (Razorpay, Stripe webhooks)
- E2E tests with Playwright
- Better warehouse search/filtering
