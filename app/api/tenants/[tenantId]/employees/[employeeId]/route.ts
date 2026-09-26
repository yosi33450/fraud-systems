import { NextResponse } from "next/server";
import { updateEmployee } from "@/lib/operational-store";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";

export async function PATCH(request: Request, context: { params: Promise<{ tenantId: string; employeeId: string }> }) {
  await hydrateOperationalState();
  const { tenantId, employeeId } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "INVALID_EMPLOYEE" }, { status: 400 });
  const { name, email, privateEmail, address, couponCodes, department } = body as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim() || typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email) || typeof department !== "string" || !department.trim()) {
    return NextResponse.json({ error: "INVALID_EMPLOYEE" }, { status: 400 });
  }
  try {
    const employee = updateEmployee(tenantId, employeeId, { name, email, department,
      privateEmail: typeof privateEmail === "string" ? privateEmail : "", address: typeof address === "string" ? address : "",
      couponCodes: Array.isArray(couponCodes) ? couponCodes.filter((code): code is string => typeof code === "string").slice(0, 30) : [] });
    await persistOperationalState();
    return NextResponse.json({ employee });
  } catch (error) {
    const message = error instanceof Error ? error.message : "EMPLOYEE_UPDATE_FAILED";
    return NextResponse.json({ error: message }, { status: message === "EMPLOYEE_NOT_FOUND" ? 404 : message === "EMPLOYEE_ALREADY_EXISTS" ? 409 : 500 });
  }
}
