import { NextResponse } from "next/server";
import { hydrateOperationalState } from "@/lib/persistence.server";
import { hydrateCrediMatchChargebacks } from "@/lib/credimatch-persistence.server";
import { exportCrediMatchChargebacks, getDashboardSnapshot } from "@/lib/operational-store";
import { getFreshStoreConnection } from "@/lib/shopify-connection.server";
import { shopifyAdminRequest } from "@/lib/shopify-admin.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUERY = `#graphql
  query CrediMatchOrderProbe($id: ID!, $reference: String!) {
    order(id: $id) {
      id name createdAt
      transactions { id gateway formattedGateway paymentId receiptJson }
    }
    orders(first: 10, query: $reference) { nodes { id name } }
  }
`;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  const discrepancyId = url.searchParams.get("discrepancyId");
  if (!orderId || !/^\d{8,20}$/.test(orderId) || !discrepancyId || !/^\d{1,30}$/.test(discrepancyId)) {
    return NextResponse.json({ error: "INVALID_PROBE" }, { status: 400 });
  }
  try {
    await hydrateOperationalState({ refresh: true });
    await hydrateCrediMatchChargebacks();
    const item = exportCrediMatchChargebacks().find((entry) => entry.discrepancyId === discrepancyId);
    if (!item?.payplus?.merchantReference) return NextResponse.json({ error: "REFERENCE_NOT_FOUND" }, { status: 404 });
    const store = getDashboardSnapshot(item.tenantId).stores.find((entry) => entry.domain === "strongfulclothing.myshopify.com");
    if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });
    const connection = await getFreshStoreConnection(item.tenantId, store.id);
    const data = await shopifyAdminRequest<{
      order: { id: string; name: string; createdAt: string; transactions: Array<{ gateway: string; formattedGateway: string; paymentId: string | null; receiptJson: string | null }> } | null;
      orders: { nodes: Array<{ id: string; name: string }> };
    }>({ shopDomain: connection.store.domain, accessToken: connection.accessToken, query: QUERY,
      variables: { id: `gid://shopify/Order/${orderId}`, reference: item.payplus.merchantReference } });
    const reference = item.payplus.merchantReference;
    return NextResponse.json({
      accessible: Boolean(data.order),
      order: data.order && { id: data.order.id, name: data.order.name, createdAt: data.order.createdAt,
        transactions: data.order.transactions.map((entry) => {
          let receipt: Record<string, unknown> | null = null;
          try { receipt = entry.receiptJson ? JSON.parse(entry.receiptJson) as Record<string, unknown> : null; } catch { /* diagnostic only */ }
          return { gateway: entry.gateway, formattedGateway: entry.formattedGateway,
            paymentId: entry.paymentId, receiptKeys: receipt ? Object.keys(receipt) : [],
            receiptReferenceFields: receipt && Object.fromEntries(Object.entries(receipt)
              .filter(([key]) => /payment|reference|more.info/i.test(key))
              .map(([key, value]) => [key, typeof value === "string" ? value : "[non-string]"])),
            rawReceiptAvailable: Boolean(entry.receiptJson) };
        }) },
      rawSearchOrders: data.orders.nodes,
      expectedReference: reference,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "PROBE_FAILED" }, { status: 502 });
  }
}
