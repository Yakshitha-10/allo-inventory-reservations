import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const products = [
  {
    sku: "ALLO-TEE-001",
    name: "Everyday Recovery Tee",
    description: "Soft cotton tee for retail drops with steady D2C demand.",
    imageUrl:
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80",
    stock: [9, 3, 1],
  },
  {
    sku: "ALLO-BAG-014",
    name: "Commuter Sling Bag",
    description: "Limited batch accessory where oversells hurt the most.",
    imageUrl:
      "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80",
    stock: [2, 8, 5],
  },
  {
    sku: "ALLO-CAP-009",
    name: "Washed Canvas Cap",
    description: "Fast-moving SKU split across fulfillment centers.",
    imageUrl:
      "https://images.unsplash.com/photo-1521369909029-2afed882baee?auto=format&fit=crop&w=900&q=80",
    stock: [14, 6, 4],
  },
];

const warehouses = [
  { code: "BLR", name: "South Fulfillment", city: "Bengaluru" },
  { code: "DEL", name: "North Fulfillment", city: "Delhi NCR" },
  { code: "BOM", name: "West Fulfillment", city: "Mumbai" },
];

async function main() {
  await prisma.idempotencyRecord.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.stockLevel.deleteMany();
  await prisma.product.deleteMany();
  await prisma.warehouse.deleteMany();

  const createdWarehouses = await Promise.all(
    warehouses.map((warehouse) => prisma.warehouse.create({ data: warehouse })),
  );

  for (const product of products) {
    const createdProduct = await prisma.product.create({
      data: {
        sku: product.sku,
        name: product.name,
        description: product.description,
        imageUrl: product.imageUrl,
      },
    });

    await Promise.all(
      createdWarehouses.map((warehouse, index) =>
        prisma.stockLevel.create({
          data: {
            productId: createdProduct.id,
            warehouseId: warehouse.id,
            totalUnits: product.stock[index],
          },
        }),
      ),
    );
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
