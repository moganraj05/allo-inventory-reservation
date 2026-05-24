import { errorResponse, json } from "@/lib/http";
import { releaseReservation } from "@/lib/reservations";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const reservation = await releaseReservation(id);
    return json({ reservation });
  } catch (error) {
    return errorResponse(error);
  }
}
