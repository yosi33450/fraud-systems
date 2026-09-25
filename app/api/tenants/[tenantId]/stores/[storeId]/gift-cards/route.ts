import { NextResponse } from "next/server";
import { getStoreConnection, resolveStore, giftCardAlertOrderIds } from "@/lib/operational-store";
import { hydrateOperationalState } from "@/lib/persistence.server";
import { scanGiftEvidencePage, syncGiftEvidenceForOrder } from "@/lib/gift-card-sync.server";
import { ensureOrderWebhooks } from "@/lib/shopify-admin.server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ tenantId: string; storeId: string }> }) {
  await hydrateOperationalState();
  const { tenantId, storeId } = await context.params;
  const store = resolveStore(storeId);
  if (!store || store.tenantId !== tenantId) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });
  try {
    const body = await request.json() as { mode?: string; after?: string | null; since?: string; until?: string };
    if (body.mode && !["alerts", "all"].includes(body.mode)) return NextResponse.json({ error: "INVALID_SCAN" }, { status: 400 });
    const connection = { tenantId, storeId, shopDomain: store.domain, accessToken: getStoreConnection(tenantId, storeId).accessToken };
    const until = body.until ?? new Date().toISOString();
    const since = body.since ?? new Date(Date.parse(until) - 30 * 86400000).toISOString();
    const interval = Date.parse(until) - Date.parse(since);
    if (!Number.isFinite(interval) || interval < 0 || interval > 31 * 86400000 || Date.parse(until) > Date.now() + 60000 || (body.after != null && (typeof body.after !== "string" || body.after.length > 2000))) {
      return NextResponse.json({ error: "INVALID_SCAN" }, { status: 400 });
    }
    let result;
    if (body.mode === "alerts") {
      const ids = giftCardAlertOrderIds(tenantId, storeId).sort();
      const offset = Number(body.after ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0) return NextResponse.json({ error: "INVALID_CURSOR" }, { status: 400 });
      const batch = ids.slice(offset, offset + 5);
      for (const id of batch) await syncGiftEvidenceForOrder(connection, id);
      result = { scanned: batch.length, relevant: batch.length, after: offset + batch.length < ids.length ? String(offset + batch.length) : null };
    } else result = await scanGiftEvidencePage(connection, body.after ?? null, since, until);
    // Refresh subscriptions once per scan so issuance arriving after payment is also captured.
    let liveSetup = true;
    if (!body.after) {
      try { await ensureOrderWebhooks({ ...connection, uri: `${new URL(request.url).origin}/api/shopify/webhooks/${storeId}` }); }
      catch { liveSetup = false; }
    }
    return NextResponse.json({ ...result, since, until, liveSetup });
  } catch (error) {
    console.error("[gift-ledger] scan failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "לא ניתן להשלים את הסריקה. בדוק את חיבור החנות ונסה שוב; הראיות שכבר נשמרו נשארות במערכת." }, { status: 502 });
  }
}
