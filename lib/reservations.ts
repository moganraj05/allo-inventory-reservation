import { Prisma, ReservationStatus } from "@prisma/client";

import { ApiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import type { CreateReservationInput } from "@/lib/validation";

const RESERVATION_WINDOW_MS =
  Number(process.env.RESERVATION_WINDOW_MINUTES ?? "10") * 60 * 1000;
const TRANSACTION_OPTIONS = {
  maxWait: 15_000,
  timeout: 15_000,
};

type Tx = Prisma.TransactionClient;

export type ReservationView = {
  id: string;
  quantity: number;
  status: ReservationStatus;
  expiresAt: string;
  confirmedAt: string | null;
  releasedAt: string | null;
  product: {
    id: string;
    name: string;
    sku: string;
  };
  warehouse: {
    id: string;
    name: string;
    code: string;
    city: string;
  };
};

const reservationInclude = {
  product: { select: { id: true, name: true, sku: true } },
  warehouse: { select: { id: true, name: true, code: true, city: true } },
} satisfies Prisma.ReservationInclude;

function serializeReservation(
  reservation: Prisma.ReservationGetPayload<{ include: typeof reservationInclude }>,
): ReservationView {
  return {
    id: reservation.id,
    quantity: reservation.quantity,
    status: reservation.status,
    expiresAt: reservation.expiresAt.toISOString(),
    confirmedAt: reservation.confirmedAt?.toISOString() ?? null,
    releasedAt: reservation.releasedAt?.toISOString() ?? null,
    product: reservation.product,
    warehouse: reservation.warehouse,
  };
}

async function releaseOnePendingReservation(tx: Tx, id: string, now: Date) {
  const reservation = await tx.reservation.findUnique({
    where: { id },
    select: { id: true, productId: true, warehouseId: true, quantity: true },
  });

  if (!reservation) {
    return false;
  }

  const updated = await tx.reservation.updateMany({
    where: { id, status: ReservationStatus.PENDING },
    data: { status: ReservationStatus.RELEASED, releasedAt: now },
  });

  if (updated.count !== 1) {
    return false;
  }

  await tx.stockLevel.update({
    where: {
      productId_warehouseId: {
        productId: reservation.productId,
        warehouseId: reservation.warehouseId,
      },
    },
    data: { reservedUnits: { decrement: reservation.quantity } },
  });

  return true;
}

export async function releaseExpiredReservations(tx: Tx, now = new Date()) {
  const result = await tx.$queryRaw<Array<{ releasedCount: number }>>`
    WITH candidates AS (
      SELECT id
      FROM "Reservation"
      WHERE status = CAST(${ReservationStatus.PENDING} AS "ReservationStatus")
        AND "expiresAt" <= ${now}
      ORDER BY "expiresAt" ASC
      LIMIT 100
    ),
    released AS (
      UPDATE "Reservation"
      SET status = CAST(${ReservationStatus.RELEASED} AS "ReservationStatus"),
          "releasedAt" = ${now},
          "updatedAt" = ${now}
      WHERE id IN (SELECT id FROM candidates)
        AND status = CAST(${ReservationStatus.PENDING} AS "ReservationStatus")
      RETURNING "productId", "warehouseId", quantity
    ),
    stock_adjustments AS (
      SELECT "productId", "warehouseId", SUM(quantity)::int AS quantity
      FROM released
      GROUP BY "productId", "warehouseId"
    ),
    stock_updates AS (
      UPDATE "StockLevel" AS stock
      SET "reservedUnits" = stock."reservedUnits" - adjustments.quantity,
          "updatedAt" = ${now}
      FROM stock_adjustments AS adjustments
      WHERE stock."productId" = adjustments."productId"
        AND stock."warehouseId" = adjustments."warehouseId"
      RETURNING stock.id
    )
    SELECT COUNT(*)::int AS "releasedCount"
    FROM released
  `;

  return result[0]?.releasedCount ?? 0;
}

export async function listProductsWithAvailability() {
  return prisma.$transaction(async (tx) => {
    await releaseExpiredReservations(tx);

    const products = await tx.product.findMany({
      orderBy: { name: "asc" },
      include: {
        stockLevels: {
          orderBy: { warehouse: { code: "asc" } },
          include: {
            warehouse: {
              select: { id: true, name: true, code: true, city: true },
            },
          },
        },
      },
    });

    return products.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      description: product.description,
      warehouses: product.stockLevels.map((stock) => ({
        stockLevelId: stock.id,
        warehouse: stock.warehouse,
        totalUnits: stock.totalUnits,
        reservedUnits: stock.reservedUnits,
        availableUnits: stock.totalUnits - stock.reservedUnits,
      })),
    }));
  }, TRANSACTION_OPTIONS);
}

export async function listWarehouses() {
  return prisma.warehouse.findMany({
    orderBy: { code: "asc" },
    select: { id: true, name: true, code: true, city: true },
  });
}

export async function createReservation(input: CreateReservationInput) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await releaseExpiredReservations(tx, now);

    const rowsUpdated = await tx.$executeRaw`
      UPDATE "StockLevel"
      SET "reservedUnits" = "reservedUnits" + ${input.quantity},
          "updatedAt" = ${now}
      WHERE "productId" = ${input.productId}
        AND "warehouseId" = ${input.warehouseId}
        AND ("totalUnits" - "reservedUnits") >= ${input.quantity}
    `;

    if (rowsUpdated !== 1) {
      throw new ApiError(409, "Not enough stock is available to reserve.", "INSUFFICIENT_STOCK");
    }

    const reservation = await tx.reservation.create({
      data: {
        productId: input.productId,
        warehouseId: input.warehouseId,
        quantity: input.quantity,
        expiresAt: new Date(now.getTime() + RESERVATION_WINDOW_MS),
      },
      include: reservationInclude,
    });

    return serializeReservation(reservation);
  }, TRANSACTION_OPTIONS);
}

export async function getReservation(id: string) {
  return prisma.$transaction(async (tx) => {
    await releaseExpiredReservations(tx);

    const reservation = await tx.reservation.findUnique({
      where: { id },
      include: reservationInclude,
    });

    if (!reservation) {
      throw new ApiError(404, "Reservation not found.", "NOT_FOUND");
    }

    return serializeReservation(reservation);
  }, TRANSACTION_OPTIONS);
}

export async function confirmReservation(id: string) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const reservation = await tx.reservation.findUnique({
      where: { id },
      include: reservationInclude,
    });

    if (!reservation) {
      throw new ApiError(404, "Reservation not found.", "NOT_FOUND");
    }

    if (reservation.status === ReservationStatus.CONFIRMED) {
      return serializeReservation(reservation);
    }

    if (reservation.status === ReservationStatus.RELEASED) {
      if (reservation.expiresAt <= now) {
        throw new ApiError(410, "Reservation expired before it could be confirmed.", "RESERVATION_EXPIRED");
      }

      throw new ApiError(409, "Reservation has already been released.", "RESERVATION_RELEASED");
    }

    if (reservation.expiresAt <= now) {
      await releaseOnePendingReservation(tx, id, now);
      throw new ApiError(410, "Reservation expired before it could be confirmed.", "RESERVATION_EXPIRED");
    }

    const updated = await tx.reservation.updateMany({
      where: { id, status: ReservationStatus.PENDING },
      data: { status: ReservationStatus.CONFIRMED, confirmedAt: now },
    });

    if (updated.count !== 1) {
      throw new ApiError(409, "Reservation could not be confirmed because it changed state.", "RESERVATION_CONFLICT");
    }

    const stockRowsUpdated = await tx.$executeRaw`
      UPDATE "StockLevel"
      SET "totalUnits" = "totalUnits" - ${reservation.quantity},
          "reservedUnits" = "reservedUnits" - ${reservation.quantity},
          "updatedAt" = ${now}
      WHERE "productId" = ${reservation.productId}
        AND "warehouseId" = ${reservation.warehouseId}
        AND "reservedUnits" >= ${reservation.quantity}
    `;

    if (stockRowsUpdated !== 1) {
      throw new ApiError(409, "Reserved stock was not available to confirm.", "STOCK_CONFIRM_CONFLICT");
    }

    const confirmed = await tx.reservation.findUniqueOrThrow({
      where: { id },
      include: reservationInclude,
    });

    return serializeReservation(confirmed);
  }, TRANSACTION_OPTIONS);
}

export async function releaseReservation(id: string) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const reservation = await tx.reservation.findUnique({
      where: { id },
      include: reservationInclude,
    });

    if (!reservation) {
      throw new ApiError(404, "Reservation not found.", "NOT_FOUND");
    }

    if (reservation.status === ReservationStatus.CONFIRMED) {
      throw new ApiError(409, "Confirmed reservations cannot be released.", "ALREADY_CONFIRMED");
    }

    if (reservation.status === ReservationStatus.RELEASED) {
      return serializeReservation(reservation);
    }

    await releaseOnePendingReservation(tx, id, now);

    const released = await tx.reservation.findUniqueOrThrow({
      where: { id },
      include: reservationInclude,
    });

    return serializeReservation(released);
  }, TRANSACTION_OPTIONS);
}
