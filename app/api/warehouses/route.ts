import { errorResponse, json } from "@/lib/http";
import { listWarehouses } from "@/lib/reservations";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const warehouses = await listWarehouses();
    return json({ warehouses });
  } catch (error) {
    return errorResponse(error);
  }
}
