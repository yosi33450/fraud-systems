import { NextResponse } from "next/server";
import { getObservedEmployeeDiscountCodes, resolveStore } from "@/lib/operational-store";
import { getFreshStoreConnection } from "@/lib/shopify-connection.server";
import { hydrateOperationalState } from "@/lib/persistence.server";
import { shopifyAdminRequest } from "@/lib/shopify-admin.server";

const QUERY = `#graphql
  query EmployeeCouponCodes($after: String) {
    discountNodes(first: 100, after: $after) {
      nodes {
        discount {
          ... on DiscountCodeBasic { title status asyncUsageCount codes(first: 250) { nodes { code asyncUsageCount } pageInfo { hasNextPage } } }
          ... on DiscountCodeBxgy { title status asyncUsageCount codes(first: 250) { nodes { code asyncUsageCount } pageInfo { hasNextPage } } }
          ... on DiscountCodeFreeShipping { title status asyncUsageCount codes(first: 250) { nodes { code asyncUsageCount } pageInfo { hasNextPage } } }
          ... on DiscountCodeApp { title status asyncUsageCount codes(first: 250) { nodes { code asyncUsageCount } pageInfo { hasNextPage } } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ACCESS_QUERY = `#graphql
  query EmployeeDiscountAccess {
    currentAppInstallation { accessScopes { handle } }
  }
`;
type ShopifyCoupon = { code: string; title: string; status: string; shopifyUses: number | null };
type CouponResponse = { discountNodes: { nodes: Array<{ discount: { title?: string; status?: string; asyncUsageCount?: number; codes?: { nodes: Array<{ code: string; asyncUsageCount?: number }>; pageInfo: { hasNextPage: boolean } } } }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
type CouponWarning = "permission" | "connection" | "scan_failed";

function failureReason(error: unknown): CouponWarning {
  const message = error instanceof Error ? error.message : String(error);
  if (/read_discounts|access denied|permission|scope/i.test(message)) return "permission";
  if (/reconnect|expired|unauthorized|http_401|http_403|invalid_client|not_installed/i.test(message)) return "connection";
  return "scan_failed";
}

export async function GET(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  await hydrateOperationalState();
  const { tenantId } = await context.params;
  const url = new URL(request.url);
  const storeId = url.searchParams.get("storeId") ?? "";
  const prefix = (url.searchParams.get("prefix") ?? "").trim().toLowerCase();
  const store = resolveStore(storeId);
  if (!store || store.tenantId !== tenantId) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });
  if (prefix && !/^[a-z0-9_-]{2,24}$/.test(prefix)) return NextResponse.json({ error: "INVALID_PREFIX" }, { status: 400 });
  const observedCodes = getObservedEmployeeDiscountCodes(tenantId, storeId, prefix);
  try {
    const connection = await getFreshStoreConnection(tenantId, storeId);
    const access = await shopifyAdminRequest<{ currentAppInstallation: { accessScopes: Array<{ handle: string }> } }>({
      shopDomain: store.domain, accessToken: connection.accessToken, query: ACCESS_QUERY,
    });
    if (!access.currentAppInstallation.accessScopes.some((scope) => scope.handle === "read_discounts")) {
      return NextResponse.json({ codes: observedCodes, coupons: observedCodes.map((code) => ({ code, title: "", status: "OBSERVED", shopifyUses: null })), source: "orders", warning: "permission" });
    }
    const coupons = new Map<string, ShopifyCoupon>();
    let after: string | null = null;
    let partial = false;
    for (let page = 0; page < 40; page++) {
      const result: CouponResponse = await shopifyAdminRequest<CouponResponse>({ shopDomain: store.domain, accessToken: connection.accessToken, query: QUERY, variables: { after } });
      for (const node of result.discountNodes.nodes) {
        if (node.discount.codes?.pageInfo.hasNextPage) partial = true;
        for (const entry of node.discount.codes?.nodes ?? []) {
          if (entry.code.toLowerCase().startsWith(prefix)) coupons.set(entry.code.toLowerCase(), {
            code: entry.code, title: node.discount.title ?? "", status: node.discount.status ?? "", shopifyUses: entry.asyncUsageCount ?? node.discount.asyncUsageCount ?? null,
          });
        }
      }
      if (!result.discountNodes.pageInfo.hasNextPage || !result.discountNodes.pageInfo.endCursor) break;
      if (page === 39) partial = true;
      after = result.discountNodes.pageInfo.endCursor;
    }
    for (const code of observedCodes) {
      if (!coupons.has(code.toLowerCase())) coupons.set(code.toLowerCase(), { code, title: "", status: "OBSERVED", shopifyUses: null });
    }
    const catalog = [...coupons.values()].sort((left, right) => left.code.localeCompare(right.code));
    return NextResponse.json({ codes: catalog.map((coupon) => coupon.code), coupons: catalog, source: "shopify", partial });
  } catch (error) {
    const warning = failureReason(error);
    const message = error instanceof Error ? error.message.slice(0, 220) : String(error).slice(0, 220);
    console.warn("[employee-coupons] Shopify code scan unavailable", { tenantId, storeId, warning, message });
    return NextResponse.json({ codes: observedCodes, coupons: observedCodes.map((code) => ({ code, title: "", status: "OBSERVED", shopifyUses: null })), source: "orders", warning });
  }
}
