import { NextResponse } from "next/server";
import { getEmployeeDiscountActivity } from "@/lib/operational-store";
import { hydrateOperationalState } from "@/lib/persistence.server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  await hydrateOperationalState();
  const { tenantId } = await context.params;
  return NextResponse.json(getEmployeeDiscountActivity(tenantId, "all"), {
    headers: { "Cache-Control": "no-store" },
  });
}
