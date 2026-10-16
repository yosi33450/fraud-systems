import { NextResponse } from "next/server";
import { getCaseCustomerHistory } from "@/lib/operational-store";
import { hydrateOperationalState } from "@/lib/persistence.server";

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string; caseId: string }> }) {
  await hydrateOperationalState();
  const { tenantId, caseId } = await context.params;
  const orders = getCaseCustomerHistory(tenantId, caseId);
  return NextResponse.json(orders ? { orders } : { error: "CASE_NOT_FOUND" }, { status: orders ? 200 : 404, headers: { "Cache-Control": "no-store" } });
}
