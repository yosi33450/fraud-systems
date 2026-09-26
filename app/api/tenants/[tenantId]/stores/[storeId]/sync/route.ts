import { NextResponse } from "next/server";
import { getFreshStoreConnection } from "@/lib/shopify-connection.server";
import { ensureOrderWebhooks } from "@/lib/shopify-admin.server";
import { syncOrdersPage } from "@/lib/shopify-sync.server";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ tenantId: string; storeId: string }> }) {
  await hydrateOperationalState();
  const { tenantId, storeId } = await context.params;
  try {
    const connection = await getFreshStoreConnection(tenantId, storeId);
    const body = await request.json().catch(() => ({})) as { since?: string; after?: string | null; scanned?: number };
    const lowerBound = Date.now() - 31 * 86_400_000;
    const since = body.since && Number.isFinite(Date.parse(body.since)) && Date.parse(body.since) >= lowerBound && Date.parse(body.since) <= Date.now()
      ? body.since
      : new Date(Date.now() - 30 * 86_400_000).toISOString();
    const sync = await syncOrdersPage({
      tenantId,
      storeId,
      shopDomain: connection.store.domain,
      accessToken: connection.accessToken,
      since,
      after: typeof body.after === "string" ? body.after : null,
      scanned: Number.isSafeInteger(body.scanned) && Number(body.scanned) >= 0 ? Number(body.scanned) : 0,
    });
    const webhooks = sync.complete ? await ensureOrderWebhooks({
      shopDomain: connection.store.domain, accessToken: connection.accessToken,
      uri: new URL(`/api/shopify/webhooks/${storeId}`, request.url).toString(),
    }) : null;
    await persistOperationalState();
    return NextResponse.json({ synced: true, ...sync, since, webhooks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SHOPIFY_SYNC_FAILED";
    console.error("[shopify-sync] failed", { tenantId, storeId, code: message });
    return NextResponse.json({ synced: false, error: message }, { status: 502 });
  }
}
