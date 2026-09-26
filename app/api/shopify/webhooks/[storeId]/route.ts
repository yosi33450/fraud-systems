import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getStoreWebhookSecret, ingestShopifyOrder, resolveStore } from "@/lib/operational-store";
import { getFreshStoreConnection } from "@/lib/shopify-connection.server";
import { notifyStoreOwners } from "@/lib/email-notifications.server";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";
import { syncShopifyOrderGiftCards } from "@/lib/shopify-sync.server";

export const runtime = "nodejs";

function verifyShopifyHmac(rawBody: string, receivedHmac: string | null, secret: string) {
  if (!receivedHmac) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const received = Buffer.from(receivedHmac, "base64");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
  await hydrateOperationalState();
  const { storeId } = await context.params;
  const rawBody = await request.text();
  const store = resolveStore(storeId);
  if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });
  const secret = getStoreWebhookSecret(storeId) ?? process.env.SHOPIFY_WEBHOOK_SECRET;

  if (!secret) {
    return NextResponse.json({ error: "WEBHOOK_SECRET_NOT_CONFIGURED" }, { status: 503 });
  }
  if (!verifyShopifyHmac(rawBody, request.headers.get("x-shopify-hmac-sha256"), secret)) {
    return NextResponse.json({ error: "INVALID_WEBHOOK_SIGNATURE" }, { status: 401 });
  }

  const webhookId = request.headers.get("x-shopify-webhook-id");
  const topic = request.headers.get("x-shopify-topic") ?? "unknown";
  const shopDomain = request.headers.get("x-shopify-shop-domain");
  if (shopDomain && shopDomain !== store.domain) {
    return NextResponse.json({ error: "SHOP_DOMAIN_MISMATCH" }, { status: 403 });
  }
  if (!webhookId) return NextResponse.json({ error: "MISSING_WEBHOOK_ID" }, { status: 400 });
  const payload: unknown = JSON.parse(rawBody);

  if (!topic.startsWith("orders/") && topic !== "order_transactions/create" && topic !== "refunds/create") {
    return NextResponse.json({ accepted: true, ignored: true, storeId, webhookId, topic }, { status: 202 });
  }

  try {
    let result;
    const orderPayload = payload as Parameters<typeof ingestShopifyOrder>[0]["payload"];
    const isGiftOrder = orderPayload.line_items?.some((item) => item.gift_card)
      || (payload as { payment_gateway_names?: string[] }).payment_gateway_names?.some((gateway) => /gift.?card/i.test(gateway));
    if (topic === "order_transactions/create" || topic === "orders/risk_assessment_changed" || topic === "refunds/create" || (topic.startsWith("orders/") && isGiftOrder)) {
      const transaction = payload as { order_id?: string | number; admin_graphql_api_order_id?: string; order?: { id?: string } };
      const rawOrderId = topic === "order_transactions/create" || topic === "orders/risk_assessment_changed" || topic === "refunds/create"
        ? transaction.admin_graphql_api_order_id ?? transaction.order_id ?? transaction.order?.id
        : orderPayload.admin_graphql_api_id ?? orderPayload.id;
      if (!rawOrderId) return NextResponse.json({ error: "ORDER_ID_MISSING" }, { status: 400 });
      const orderId = String(rawOrderId).startsWith("gid://") ? String(rawOrderId) : `gid://shopify/Order/${rawOrderId}`;
      const connection = await getFreshStoreConnection(store.tenantId, storeId);
      result = await syncShopifyOrderGiftCards({
        tenantId: store.tenantId,
        storeId,
        shopDomain: store.domain,
        accessToken: connection.accessToken,
        orderId,
        webhookId,
        topic,
      });
    } else {
      result = ingestShopifyOrder({ storeId, webhookId, topic, payload: payload as Parameters<typeof ingestShopifyOrder>[0]["payload"] });
    }
    const deliveries = result.case ? await notifyStoreOwners(result.case) : [];
    await persistOperationalState();
    return NextResponse.json({ accepted: true, storeId, webhookId, topic, duplicate: result.duplicate, caseId: result.case?.id ?? null, notificationsQueued: deliveries.length }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WEBHOOK_PROCESSING_FAILED";
    console.error("[shopify-webhook] processing failed", { storeId, topic, code: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
