import { NextResponse } from "next/server";
import { chargebackCustomerKey } from "@/lib/chargeback-customer-context";
import { hydrateCrediMatchChargebacks } from "@/lib/credimatch-persistence.server";
import { getDashboardSnapshot } from "@/lib/operational-store";
import { hydrateOperationalState } from "@/lib/persistence.server";
import { shopifyAdminRequest } from "@/lib/shopify-admin.server";
import { getFreshStoreConnection } from "@/lib/shopify-connection.server";
import { CREDIMATCH_ORDER_ACCESS_QUERY, CREDIMATCH_ORDER_CANDIDATES_QUERY } from "@/lib/shopify-sync.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OrderNode = {
  id: string; name: string; createdAt: string; email?: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer?: { defaultEmailAddress?: { emailAddress: string } | null } | null;
};

export async function GET(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await context.params;
  const discrepancyId = new URL(request.url).searchParams.get("discrepancyId");
  if (!discrepancyId || discrepancyId.length > 100) return NextResponse.json({ error: "INVALID_DISCREPANCY_ID" }, { status: 400 });
  try {
    await hydrateOperationalState({ refresh: true });
    await hydrateCrediMatchChargebacks();
    const snapshot = getDashboardSnapshot(tenantId);
    const item = snapshot.chargebacks.find((chargeback) => chargeback.discrepancyId === discrepancyId);
    const key = item && chargebackCustomerKey(item);
    if (!item || !key || !item.match?.createdAt || !item.match.storeId) {
      return NextResponse.json({ error: "CUSTOMER_HISTORY_UNAVAILABLE" }, { status: 404 });
    }
    const email = item.match.email!.trim().toLowerCase();
    const orderDate = new Date(item.match.createdAt);
    if (!Number.isFinite(orderDate.getTime())) return NextResponse.json({ error: "INVALID_ORDER_DATE" }, { status: 422 });
    // The month is defined in the merchant's local (Israel) calendar, not UTC.
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" }).formatToParts(orderDate);
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    // Widen the search slightly for daylight-saving transitions, then filter
    // by the actual local month below.
    const since = new Date(Date.UTC(year, month - 1, 1) - 24 * 3_600_000).toISOString();
    const until = new Date(Date.UTC(year, month, 1) + 24 * 3_600_000).toISOString();
    const connection = await getFreshStoreConnection(tenantId, item.match.storeId);
    if (Date.parse(since) < Date.now() - 60 * 86_400_000) {
      const access = await shopifyAdminRequest<{ currentAppInstallation: { accessScopes: Array<{ handle: string }> } }>({
        shopDomain: connection.store.domain, accessToken: connection.accessToken, query: CREDIMATCH_ORDER_ACCESS_QUERY,
      });
      if (!access.currentAppInstallation.accessScopes.some((scope) => scope.handle === "read_all_orders")) {
        return NextResponse.json({ error: "SHOPIFY_READ_ALL_ORDERS_REQUIRED" }, { status: 403 });
      }
    }
    const safeEmail = email.replace(/["\\]/g, "");
    const query = `created_at:>=${since} created_at:<${until} email:${safeEmail}`;
    const orders = new Map<string, { orderId: string; orderNumber: string; createdAt: string; amount: number; currency: string; disputed: boolean }>();
    const disputedIds = new Set(snapshot.chargebacks.filter((chargeback) => chargeback.match?.confidence === "exact")
      .map((chargeback) => chargeback.match?.orderId));
    let after: string | null = null;
    let truncated = false;
    for (let page = 0; page < 5; page += 1) {
      const data: { orders: { nodes: OrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await shopifyAdminRequest({
        shopDomain: connection.store.domain,
        accessToken: connection.accessToken,
        query: CREDIMATCH_ORDER_CANDIDATES_QUERY,
        variables: { first: 100, after, query },
      });
      for (const order of data.orders.nodes) {
        if ((order.email ?? order.customer?.defaultEmailAddress?.emailAddress ?? "").trim().toLowerCase() !== email) continue;
        const localParts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" }).formatToParts(new Date(order.createdAt));
        if (Number(localParts.find((part) => part.type === "year")?.value) !== year
          || Number(localParts.find((part) => part.type === "month")?.value) !== month) continue;
        const amount = Number(order.totalPriceSet.shopMoney.amount);
        orders.set(order.id, { orderId: order.id, orderNumber: order.name, createdAt: order.createdAt,
          amount: Number.isFinite(amount) ? amount : 0, currency: order.totalPriceSet.shopMoney.currencyCode,
          disputed: disputedIds.has(order.id) });
      }
      after = data.orders.pageInfo.endCursor;
      if (!data.orders.pageInfo.hasNextPage) break;
      if (!after || page === 4) { truncated = true; break; }
    }
    return NextResponse.json({ month: `${year}-${String(month).padStart(2, "0")}`, email,
      orders: [...orders.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)), truncated },
    { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.warn("[credimatch-customer-month] lookup failed", { code: error instanceof Error ? error.message : "UNKNOWN" });
    return NextResponse.json({ error: "CUSTOMER_HISTORY_LOOKUP_FAILED" }, { status: 502 });
  }
}
