import type { NextRequest } from "next/server";

import { errorResponse, json } from "@/lib/http";
import { runIdempotently } from "@/lib/idempotency";
import { createReservation } from "@/lib/reservations";
import { createReservationSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const input = createReservationSchema.parse(await request.json());
    const result = await runIdempotently(request, "/api/reservations", async () => ({
      body: { reservation: await createReservation(input) },
      status: 201,
    }));

    return json(result.body, result.status);
  } catch (error) {
    return errorResponse(error);
  }
}
