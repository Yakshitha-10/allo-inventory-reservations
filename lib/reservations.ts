import { Prisma, ReservationStatus } from "@prisma/client";
import type { DbClient } from "@/lib/api";

const RESERVATION_TTL_MINUTES = 10;

type StockRow = {
  id: string;
};

type ExpiredRow = {
  id: string;
};

export function reservationExpiresAt(now = new Date()) {
  return new Date(now.getTime() + RESERVATION_TTL_MINUTES * 60 * 1000);
}

export async function releaseExpiredReservations(db: DbClient) {
  const expired = await db.$queryRaw<ExpiredRow[]>`
    WITH expired AS (
      UPDATE "Reservation"
      SET "status" = 'released'::"ReservationStatus",
          "releasedAt" = NOW(),
          "updatedAt" = NOW()
      WHERE "status" = 'pending'::"ReservationStatus"
        AND "expiresAt" <= NOW()
      RETURNING "id", "productId", "warehouseId", "quantity"
    ),
    grouped AS (
      SELECT "productId", "warehouseId", SUM("quantity")::int AS "quantity"
      FROM expired
      GROUP BY "productId", "warehouseId"
    )
    UPDATE "StockLevel" AS stock
    SET "reservedUnits" = GREATEST(0, stock."reservedUnits" - grouped."quantity"),
        "updatedAt" = NOW()
    FROM grouped
    WHERE stock."productId" = grouped."productId"
      AND stock."warehouseId" = grouped."warehouseId"
    RETURNING stock."id"
  `;

  return expired.length;
}

export async function reserveUnits(
  db: DbClient,
  input: { productId: string; warehouseId: string; quantity: number },
) {
  await releaseExpiredReservations(db);

  const stockRows = await db.$queryRaw<StockRow[]>`
    UPDATE "StockLevel"
    SET "reservedUnits" = "reservedUnits" + ${input.quantity},
        "updatedAt" = NOW()
    WHERE "productId" = ${input.productId}
      AND "warehouseId" = ${input.warehouseId}
      AND ("totalUnits" - "reservedUnits") >= ${input.quantity}
    RETURNING "id"
  `;

  if (stockRows.length === 0) {
    return null;
  }

  return db.reservation.create({
    data: {
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantity: input.quantity,
      expiresAt: reservationExpiresAt(),
    },
    include: {
      product: true,
      warehouse: true,
    },
  });
}

export async function confirmReservation(db: DbClient, reservationId: string) {
  const reservation = await db.reservation.findUnique({
    where: { id: reservationId },
    include: { product: true, warehouse: true },
  });

  if (!reservation) {
    return { kind: "not_found" as const };
  }

  if (reservation.status === ReservationStatus.confirmed) {
    return { kind: "ok" as const, reservation };
  }

  if (reservation.status === ReservationStatus.released) {
    return { kind: "released" as const, reservation };
  }

  if (reservation.expiresAt <= new Date()) {
    await releaseSingleReservation(db, reservationId);
    return { kind: "expired" as const };
  }

  const stockRows = await db.$queryRaw<StockRow[]>`
    UPDATE "StockLevel"
    SET "totalUnits" = "totalUnits" - ${reservation.quantity},
        "reservedUnits" = "reservedUnits" - ${reservation.quantity},
        "updatedAt" = NOW()
    WHERE "productId" = ${reservation.productId}
      AND "warehouseId" = ${reservation.warehouseId}
      AND "reservedUnits" >= ${reservation.quantity}
      AND "totalUnits" >= ${reservation.quantity}
    RETURNING "id"
  `;

  if (stockRows.length === 0) {
    throw new Error("Stock invariant violated while confirming reservation.");
  }

  const confirmed = await db.reservation.update({
    where: { id: reservationId },
    data: {
      status: ReservationStatus.confirmed,
      confirmedAt: new Date(),
    },
    include: { product: true, warehouse: true },
  });

  return { kind: "ok" as const, reservation: confirmed };
}

export async function releaseSingleReservation(db: DbClient, reservationId: string) {
  const reservation = await db.reservation.findUnique({
    where: { id: reservationId },
    include: { product: true, warehouse: true },
  });

  if (!reservation) {
    return { kind: "not_found" as const };
  }

  if (reservation.status === ReservationStatus.released) {
    return { kind: "ok" as const, reservation };
  }

  if (reservation.status === ReservationStatus.confirmed) {
    return { kind: "confirmed" as const, reservation };
  }

  const stockRows = await db.$queryRaw<StockRow[]>`
    UPDATE "StockLevel"
    SET "reservedUnits" = "reservedUnits" - ${reservation.quantity},
        "updatedAt" = NOW()
    WHERE "productId" = ${reservation.productId}
      AND "warehouseId" = ${reservation.warehouseId}
      AND "reservedUnits" >= ${reservation.quantity}
    RETURNING "id"
  `;

  if (stockRows.length === 0) {
    throw new Error("Stock invariant violated while releasing reservation.");
  }

  const released = await db.reservation.update({
    where: { id: reservationId },
    data: {
      status: ReservationStatus.released,
      releasedAt: new Date(),
    },
    include: { product: true, warehouse: true },
  });

  return { kind: "ok" as const, reservation: released };
}

export function serializeReservation<T extends { expiresAt: Date; createdAt: Date; updatedAt: Date }>(
  reservation: T,
) {
  return {
    ...reservation,
    expiresAt: reservation.expiresAt.toISOString(),
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
    confirmedAt:
      "confirmedAt" in reservation && reservation.confirmedAt instanceof Date
        ? reservation.confirmedAt.toISOString()
        : null,
    releasedAt:
      "releasedAt" in reservation && reservation.releasedAt instanceof Date
        ? reservation.releasedAt.toISOString()
        : null,
  };
}
