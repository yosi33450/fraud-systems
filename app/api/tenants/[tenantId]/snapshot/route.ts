import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/operational-store";
import { hydrateOperationalState } from "@/lib/persistence.server";
import { hydrateGiftEvidence } from "@/lib/gift-card-persistence.server";
import { hydrateCrediMatchChargebacks } from "@/lib/credimatch-persistence.server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  await hydrateOperationalState({ refresh: true });
  await hydrateCrediMatchChargebacks();
  const { tenantId } = await context.params;
  await hydrateGiftEvidence(tenantId);
  return NextResponse.json(getDashboardSnapshot(tenantId), {
    headers: { "Cache-Control": "no-store" },
  });
}
