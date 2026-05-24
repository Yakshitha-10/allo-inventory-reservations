import { type NextRequest } from "next/server";
import { ZodError } from "zod";
import { error, json, parseJson, withIdempotency } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { reserveUnits, serializeReservation } from "@/lib/reservations";
import { reserveSchema } from "@/lib/schemas";

export async function POST(request: NextRequest) {
  const body = await parseJson(request);
  const parsed = reserveSchema.safeParse(body);

  if (!parsed.success) {
    return json(error(400, "Invalid reservation request.", parsed.error.flatten()));
  }

  return withIdempotency(prisma, request, "reserve", parsed.data, async (tx) => {
    try {
      const reservation = await reserveUnits(tx, parsed.data);

      if (!reservation) {
        return error(409, "Not enough stock is available for this warehouse.");
      }

      return {
        status: 201,
        body: { reservation: serializeReservation(reservation) },
      };
    } catch (cause) {
      if (cause instanceof ZodError) {
        return error(400, "Invalid reservation request.", cause.flatten());
      }
      throw cause;
    }
  });
}
