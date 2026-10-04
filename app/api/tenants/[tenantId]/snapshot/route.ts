import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/operational-store";
import { hydrateOperationalState } from "@/lib/persistence.server";
import { hydrateGiftEvidence } from "@/lib/gift-card-persistence.server";
import { hydrateCrediMatchChargebacks } from "@/lib/credimatch-persistence.server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  await hydrateOperationalState({ refresh: true });
  const { tenantId } = await context.params;
  // Chargebacks are persisted separately from the Shopify snapshot.  Await
  // their small encrypted document here so a cold instance never sends an
  // empty chargeback screen before the hydration finishes.
  await hydrateCrediMatchChargebacks();
  void hydrateGiftEvidence(tenantId).catch(() => undefined);
  return NextResponse.json(getDashboardSnapshot(tenantId), {
    headers: { "Cache-Control": "no-store" },
  });
}
