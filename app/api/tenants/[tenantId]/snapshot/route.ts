import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/operational-store";
import { hydrateOperationalState } from "@/lib/persistence.server";
import { hydrateGiftEvidence } from "@/lib/gift-card-persistence.server";
import { hydrateCrediMatchChargebacks } from "@/lib/credimatch-persistence.server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  await hydrateOperationalState({ refresh: true });
  const { tenantId } = await context.params;
  // These independent ledgers enrich the response after a warm start. They
  // must never delay the primary Shopify snapshot or make a store look gone.
  void hydrateCrediMatchChargebacks().catch(() => undefined);
  void hydrateGiftEvidence(tenantId).catch(() => undefined);
  return NextResponse.json(getDashboardSnapshot(tenantId), {
    headers: { "Cache-Control": "no-store" },
  });
}
