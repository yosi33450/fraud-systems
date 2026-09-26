import { NextResponse } from "next/server";
import { pendingVelocityPolicyOrders, reevaluateOpenCases, repairVelocityPolicy } from "@/lib/operational-store";
import { getFreshStoreConnection } from "@/lib/shopify-connection.server";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";
import { hydrateGiftEvidence } from "@/lib/gift-card-persistence.server";
import { syncShopifyOrderGiftCards } from "@/lib/shopify-sync.server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Owner session is required by proxy.ts, just like all rule-edit endpoints.
export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const body = await request.json().catch(() => null);
  if (body?.policy !== "velocity-windows-v3") return NextResponse.json({ error: "INVALID_POLICY" }, { status: 400 });
  const { tenantId } = await context.params;
  await hydrateOperationalState();
  await hydrateGiftEvidence(tenantId);
  try {
    const { cases: _cases, ...reconciliation } = repairVelocityPolicy(tenantId);
    const pending = pendingVelocityPolicyOrders(tenantId);
    let created = 0;
    const failed: string[] = [];
    // Bounded and retryable; never send historical owner emails during repair.
    for (const order of pending.slice(0, 10)) {
      try {
        const connection = await getFreshStoreConnection(tenantId, order.storeId);
        const result = await syncShopifyOrderGiftCards({ tenantId, ...order,
          shopDomain: connection.store.domain, accessToken: connection.accessToken,
          topic: "HISTORICAL_SYNC", webhookId: `velocity-v3:${order.orderId}` });
        if (result.case) created += 1;
      } catch { failed.push(order.orderId); }
    }
    if (created) reconciliation.active = reevaluateOpenCases(tenantId).active;
    await persistOperationalState();
    return NextResponse.json({ reconciliation, historical: { created, pending: Math.max(0, pending.length - 10) + failed.length, failed } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RECONCILIATION_FAILED";
    return NextResponse.json({ error: message }, { status: message === "RULE_NOT_FOUND" ? 404 : 500 });
  }
}
