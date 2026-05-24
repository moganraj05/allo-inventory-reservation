import { errorResponse, json } from "@/lib/http";
import { getReservation } from "@/lib/reservations";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const reservation = await getReservation(id);
    return json({ reservation });
  } catch (error) {
    return errorResponse(error);
  }
}
