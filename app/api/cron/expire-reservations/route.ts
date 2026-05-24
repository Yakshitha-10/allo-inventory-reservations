import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseExpiredReservations } from "@/lib/reservations";

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;

  if (expected) {
    const actual = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (actual !== expected) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  const releasedStockGroups = await prisma.$transaction((tx) =>
    releaseExpiredReservations(tx),
  );

  return NextResponse.json({ releasedStockGroups });
}
