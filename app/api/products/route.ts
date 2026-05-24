import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseExpiredReservations } from "@/lib/reservations";

export async function GET() {
  await releaseExpiredReservations(prisma);

  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
    include: {
      stockLevels: {
        orderBy: { warehouse: { city: "asc" } },
        include: { warehouse: true },
      },
    },
  });

  return NextResponse.json(
    products.map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      warehouses: product.stockLevels.map((stock) => ({
        stockLevelId: stock.id,
        warehouseId: stock.warehouseId,
        code: stock.warehouse.code,
        name: stock.warehouse.name,
        city: stock.warehouse.city,
        totalUnits: stock.totalUnits,
        reservedUnits: stock.reservedUnits,
        availableUnits: stock.totalUnits - stock.reservedUnits,
      })),
    })),
  );
}
