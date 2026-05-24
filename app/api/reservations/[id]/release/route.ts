import { type NextRequest } from "next/server";
import { error, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { releaseSingleReservation, serializeReservation } from "@/lib/reservations";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const result = await prisma.$transaction((tx) => releaseSingleReservation(tx, id));

  if (result.kind === "not_found") {
    return json(error(404, "Reservation was not found."));
  }

  if (result.kind === "confirmed") {
    return json(error(409, "Confirmed reservations cannot be released."));
  }

  return json({
    status: 200,
    body: { reservation: serializeReservation(result.reservation) },
  });
}
