import { NextResponse } from "next/server";
import { addEmployee } from "@/lib/operational-store";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";

export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  await hydrateOperationalState();
  const { tenantId } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "INVALID_EMPLOYEE" }, { status: 400 });
  const { name, email, department } = body as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim() || typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email) || typeof department !== "string" || !department.trim()) {
    return NextResponse.json({ error: "INVALID_EMPLOYEE" }, { status: 400 });
  }
  try {
    const employee = addEmployee(tenantId, { name, email, department });
    await persistOperationalState();
    return NextResponse.json({ employee }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "EMPLOYEE_CREATE_FAILED";
    return NextResponse.json({ error: message }, { status: message === "EMPLOYEE_ALREADY_EXISTS" ? 409 : 500 });
  }
}
