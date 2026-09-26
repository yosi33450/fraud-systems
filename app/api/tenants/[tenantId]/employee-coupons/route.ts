import { NextResponse } from "next/server";
import { getObservedEmployeeDiscountCodes, resolveStore } from "@/lib/operational-store";
import { getFreshStoreConnection } from "@/lib/shopify-connection.server";
import { hydrateOperationalState } from "@/lib/persistence.server";
import { shopifyAdminRequest } from "@/lib/shopify-admin.server";

const QUERY = `#graphql
  query EmployeeCouponCodes($after: String) {
    discountNodes(first: 25, after: $after, query: "method:code") {
      nodes { discount {
        ... on DiscountCodeBasic { codes(first: 25) { nodes { code } pageInfo { hasNextPage } } }
        ... on DiscountCodeBxgy { codes(first: 25) { nodes { code } pageInfo { hasNextPage } } }
        ... on DiscountCodeFreeShipping { codes(first: 25) { nodes { code } pageInfo { hasNextPage } } }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ACCESS_QUERY = `#graphql query EmployeeDiscountAccess { currentAppInstallation { accessScopes { handle } } }`;
type CouponResponse = { discountNodes: { nodes: Array<{ discount: { codes?: { nodes: Array<{ code: string }>; pageInfo: { hasNextPage: boolean } } } }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
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
  if (!/^[a-z0-9_-]{2,24}$/.test(prefix)) return NextResponse.json({ error: "INVALID_PREFIX" }, { status: 400 });
  const observedCodes = getObservedEmployeeDiscountCodes(tenantId, storeId, prefix);
  try {
    const connection = await getFreshStoreConnection(tenantId, storeId);
    const access = await shopifyAdminRequest<{ currentAppInstallation: { accessScopes: Array<{ handle: string }> } }>({
      shopDomain: store.domain, accessToken: connection.accessToken, query: ACCESS_QUERY,
    });
    if (!access.currentAppInstallation.accessScopes.some((scope) => scope.handle === "read_discounts")) {
      return NextResponse.json({ codes: observedCodes, source: "orders", warning: "permission" });
    }
    const codes = new Set<string>();
    let after: string | null = null;
    let partial = false;
    for (let page = 0; page < 40; page++) {
      const result: CouponResponse = await shopifyAdminRequest<CouponResponse>({ shopDomain: store.domain, accessToken: connection.accessToken, query: QUERY, variables: { after } });
      for (const node of result.discountNodes.nodes) {
        if (node.discount.codes?.pageInfo.hasNextPage) partial = true;
        for (const entry of node.discount.codes?.nodes ?? []) {
          if (entry.code.toLowerCase().startsWith(prefix)) codes.add(entry.code);
        }
      }
      if (!result.discountNodes.pageInfo.hasNextPage || !result.discountNodes.pageInfo.endCursor) break;
      if (page === 39) partial = true;
      after = result.discountNodes.pageInfo.endCursor;
    }
    return NextResponse.json({ codes: [...new Set([...codes, ...observedCodes])].sort(), source: "shopify", partial });
  } catch (error) {
    const warning = failureReason(error);
    console.warn("[employee-coupons] Shopify code scan unavailable", { tenantId, storeId, warning });
    return NextResponse.json({ codes: observedCodes, source: "orders", warning });
  }
}
