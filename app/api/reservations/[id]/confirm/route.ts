import type { NextRequest } from "next/server";

import { errorResponse, json } from "@/lib/http";
import { runIdempotently } from "@/lib/idempotency";
import { confirmReservation } from "@/lib/reservations";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const result = await runIdempotently(
      request,
      `/api/reservations/${id}/confirm`,
      async () => ({
        body: { reservation: await confirmReservation(id) },
        status: 200,
      }),
    );

    return json(result.body, result.status);
  } catch (error) {
    return errorResponse(error);
  }
}
