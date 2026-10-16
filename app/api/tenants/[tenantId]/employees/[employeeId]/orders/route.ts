import { NextResponse } from "next/server";
import { getEmployeeOrderHistory } from "@/lib/operational-store";
import { hydrateOperationalState } from "@/lib/persistence.server";

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string; employeeId: string }> }) {
  await hydrateOperationalState();
  const { tenantId, employeeId } = await context.params;
  const orders = getEmployeeOrderHistory(tenantId, employeeId);
  return NextResponse.json(orders ? { orders } : { error: "EMPLOYEE_NOT_FOUND" }, { status: orders ? 200 : 404, headers: { "Cache-Control": "no-store" } });
}
