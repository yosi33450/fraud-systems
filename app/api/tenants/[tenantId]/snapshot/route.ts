import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/operational-store";
import { hydrateOperationalState } from "@/lib/persistence.server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  await hydrateOperationalState();
  const { tenantId } = await context.params;
  return NextResponse.json(getDashboardSnapshot(tenantId), {
    headers: { "Cache-Control": "no-store" },
  });
}
