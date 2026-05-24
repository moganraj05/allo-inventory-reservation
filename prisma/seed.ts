import { PrismaClient, ReservationStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Cleaning old data...");

  await prisma.reservation.deleteMany();
  await prisma.idempotencyRecord.deleteMany();
  await prisma.stockLevel.deleteMany();
  await prisma.product.deleteMany();
  await prisma.warehouse.deleteMany();

  console.log("Creating warehouses...");

  const warehouses = await Promise.all([
    prisma.warehouse.create({
      data: {
        name: "Mumbai Fulfillment Hub",
        code: "MUM-1",
        city: "Mumbai",
      },
    }),
    prisma.warehouse.create({
      data: {
        name: "Bengaluru Urban FC",
        code: "BLR-1",
        city: "Bengaluru",
      },
    }),
    prisma.warehouse.create({
      data: {
        name: "Delhi NCR Depot",
        code: "DEL-1",
        city: "Gurugram",
      },
    }),
    prisma.warehouse.create({
      data: {
        name: "Chennai South Warehouse",
        code: "CHE-1",
        city: "Chennai",
      },
    }),
    prisma.warehouse.create({
      data: {
        name: "Hyderabad Express Center",
        code: "HYD-1",
        city: "Hyderabad",
      },
    }),
  ]);

  console.log("Creating products...");

  const products = await Promise.all([
    prisma.product.create({
      data: {
        name: "Everyday Linen Shirt",
        sku: "APP-LINEN-SHIRT",
        description: "Lightweight premium summer shirt.",
      },
    }),
    prisma.product.create({
      data: {
        name: "Ceramic Pour-Over Kit",
        sku: "HOME-POUR-KIT",
        description: "Coffee brewing starter bundle.",
      },
    }),
    prisma.product.create({
      data: {
        name: "Trail Runner Bottle",
        sku: "OUT-BOTTLE-750",
        description: "750ml insulated sports bottle.",
      },
    }),
    prisma.product.create({
      data: {
        name: "Wireless Gaming Mouse",
        sku: "ELEC-MOUSE-001",
        description: "High precision gaming mouse.",
      },
    }),
    prisma.product.create({
      data: {
        name: "Mechanical Keyboard",
        sku: "ELEC-KB-001",
        description: "RGB backlit mechanical keyboard.",
      },
    }),
    prisma.product.create({
      data: {
        name: "Noise Cancelling Headphones",
        sku: "ELEC-HEAD-001",
        description: "Premium over-ear headphones.",
      },
    }),
    prisma.product.create({
      data: {
        name: "Yoga Mat Pro",
        sku: "FIT-MAT-001",
        description: "Non-slip workout yoga mat.",
      },
    }),
    prisma.product.create({
      data: {
        name: "Protein Shaker Bottle",
        sku: "FIT-SHAKER-001",
        description: "Leak-proof gym shaker bottle.",
      },
    }),
    prisma.product.create({
      data: {
        name: "Smart LED Bulb",
        sku: "HOME-LED-001",
        description: "WiFi enabled smart bulb.",
      },
    }),
    prisma.product.create({
      data: {
        name: "Portable SSD 1TB",
        sku: "ELEC-SSD-001",
        description: "Fast external storage drive.",
      },
    }),
  ]);

  console.log("Creating stock levels...");

  const stockEntries = [];

  for (const product of products) {
    for (const warehouse of warehouses) {
      const totalUnits = Math.floor(Math.random() * 100) + 10;
      const reservedUnits = Math.floor(Math.random() * 20);

      stockEntries.push({
        productId: product.id,
        warehouseId: warehouse.id,
        totalUnits,
        reservedUnits,
      });
    }
  }

  await prisma.stockLevel.createMany({
    data: stockEntries,
  });

  console.log("Creating reservations...");

  await prisma.reservation.createMany({
    data: [
      {
        productId: products[0].id,
        warehouseId: warehouses[0].id,
        quantity: 2,
        status: ReservationStatus.PENDING,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
      {
        productId: products[3].id,
        warehouseId: warehouses[1].id,
        quantity: 1,
        status: ReservationStatus.CONFIRMED,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        confirmedAt: new Date(),
      },
      {
        productId: products[5].id,
        warehouseId: warehouses[2].id,
        quantity: 3,
        status: ReservationStatus.RELEASED,
        expiresAt: new Date(),
        releasedAt: new Date(),
      },
      {
        productId: products[7].id,
        warehouseId: warehouses[3].id,
        quantity: 5,
        status: ReservationStatus.PENDING,
        expiresAt: new Date(Date.now() + 45 * 60 * 1000),
      },
    ],
  });

  console.log("Creating idempotency records...");

  await prisma.idempotencyRecord.createMany({
    data: [
      {
        key: "reserve-product-001",
        method: "POST",
        path: "/api/reservations",
        statusCode: 201,
        response: {
          message: "Reservation created successfully",
        },
        completedAt: new Date(),
      },
      {
        key: "confirm-reservation-001",
        method: "PATCH",
        path: "/api/reservations/confirm",
        statusCode: 200,
        response: {
          message: "Reservation confirmed",
        },
        completedAt: new Date(),
      },
    ],
  });

  console.log("Seed completed successfully!");
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