import { NextResponse } from "next/server";
import { getStoreConnection } from "@/lib/operational-store";
import { ensureOrderWebhooks } from "@/lib/shopify-admin.server";
import { syncOrdersLast30Days } from "@/lib/shopify-sync.server";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ tenantId: string; storeId: string }> }) {
  await hydrateOperationalState();
  const { tenantId, storeId } = await context.params;
  try {
    const connection = getStoreConnection(tenantId, storeId);
    const sync = await syncOrdersLast30Days({
      tenantId,
      storeId,
      shopDomain: connection.store.domain,
      accessToken: connection.accessToken,
    });
    const webhooks = await ensureOrderWebhooks({
      shopDomain: connection.store.domain,
      accessToken: connection.accessToken,
      uri: new URL(`/api/shopify/webhooks/${storeId}`, request.url).toString(),
    });
    await persistOperationalState();
    return NextResponse.json({ synced: true, ...sync, webhooks });
  } catch (error) {
    await persistOperationalState().catch(() => undefined);
    const message = error instanceof Error ? error.message : "SHOPIFY_SYNC_FAILED";
    console.error("[shopify-sync] failed", { tenantId, storeId, code: message });
    return NextResponse.json({ synced: false, error: message }, { status: 502 });
  }
}
