import { errorResponse, json } from "@/lib/http";
import { listProductsWithAvailability } from "@/lib/reservations";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const products = await listProductsWithAvailability();
    return json({ products });
  } catch (error) {
    return errorResponse(error);
  }
}
