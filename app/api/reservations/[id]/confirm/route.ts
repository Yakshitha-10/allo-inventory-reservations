import { type NextRequest } from "next/server";
import { error, json, withIdempotency } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { confirmReservation, serializeReservation } from "@/lib/reservations";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;

  return withIdempotency(prisma, request, `confirm:${id}`, { id }, async (tx) => {
    const result = await confirmReservation(tx, id);

    if (result.kind === "not_found") {
      return error(404, "Reservation was not found.");
    }

    if (result.kind === "expired") {
      return error(410, "Reservation expired before payment was confirmed.");
    }

    if (result.kind === "released") {
      return error(409, "Reservation has already been released.");
    }

    return {
      status: 200,
      body: { reservation: serializeReservation(result.reservation) },
    };
  });
}
