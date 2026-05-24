import { PrismaClient } from "@prisma/client";

import { createReservation } from "../lib/reservations";

const prisma = new PrismaClient();

async function main() {
  const product = await prisma.product.findFirstOrThrow({
    where: { sku: "OUT-BOTTLE-750" },
  });
  const warehouse = await prisma.warehouse.findFirstOrThrow({
    where: { code: "MUM-1" },
  });

  await prisma.reservation.deleteMany({
    where: { productId: product.id, warehouseId: warehouse.id },
  });
  await prisma.stockLevel.update({
    where: {
      productId_warehouseId: {
        productId: product.id,
        warehouseId: warehouse.id,
      },
    },
    data: { totalUnits: 1, reservedUnits: 0 },
  });

  const attempts = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      createReservation({
        productId: product.id,
        warehouseId: warehouse.id,
        quantity: 1,
      }),
    ),
  );

  const succeeded = attempts.filter((attempt) => attempt.status === "fulfilled").length;
  const rejected = attempts.length - succeeded;

  console.log(`concurrency smoke: ${succeeded} succeeded, ${rejected} rejected`);

  if (succeeded !== 1 || rejected !== 7) {
    throw new Error("Expected exactly one reservation to succeed for one available unit.");
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
