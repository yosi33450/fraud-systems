import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/operational-store";
import { hydrateOperationalState } from "@/lib/persistence.server";
import { hydrateGiftEvidence } from "@/lib/gift-card-persistence.server";
import { hydrateCrediMatchChargebacks } from "@/lib/credimatch-persistence.server";

export const dynamic = "force-dynamic";

async function hydrateOptional(source: Promise<unknown>, timeoutMs: number) {
  await Promise.race([
    source.catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  await hydrateOperationalState({ refresh: true });
  // Chargebacks and gift evidence enrich the view, but a temporary outage in
  // either source must never make the Shopify connection appear disconnected.
  await hydrateOptional(hydrateCrediMatchChargebacks(), 5_500);
  const { tenantId } = await context.params;
  await hydrateOptional(hydrateGiftEvidence(tenantId), 5_500);
  return NextResponse.json(getDashboardSnapshot(tenantId), {
    headers: { "Cache-Control": "no-store" },
  });
}
