import { errorResponse, json } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { releaseExpiredReservations } from "@/lib/reservations";

export const dynamic = "force-dynamic";
const TRANSACTION_OPTIONS = {
  maxWait: 15_000,
  timeout: 15_000,
} as const;

export async function POST(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const authorization = request.headers.get("authorization");
      if (authorization !== `Bearer ${secret}`) {
        return json({ error: "Unauthorized.", code: "UNAUTHORIZED" }, 401);
      }
    }

    const released = await prisma.$transaction(
      (tx) => releaseExpiredReservations(tx),
      TRANSACTION_OPTIONS,
    );
    return json({ released });
  } catch (error) {
    return errorResponse(error);
  }
}
