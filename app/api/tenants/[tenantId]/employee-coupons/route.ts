import { NextResponse } from "next/server";
import { resolveStore } from "@/lib/operational-store";
import { getFreshStoreConnection } from "@/lib/shopify-connection.server";
import { hydrateOperationalState } from "@/lib/persistence.server";
import { shopifyAdminRequest } from "@/lib/shopify-admin.server";

const QUERY = `#graphql
  query EmployeeCouponCodes($after: String, $query: String!) {
    discountNodes(first: 25, after: $after, query: $query) {
      nodes { discount {
        ... on DiscountCodeBasic { codes(first: 20) { nodes { code } } }
        ... on DiscountCodeBxgy { codes(first: 20) { nodes { code } } }
        ... on DiscountCodeFreeShipping { codes(first: 20) { nodes { code } } }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

type CouponResponse = { discountNodes: { nodes: Array<{ discount: { codes?: { nodes: Array<{ code: string }> } } }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };

export async function GET(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  await hydrateOperationalState();
  const { tenantId } = await context.params;
  const url = new URL(request.url);
  const storeId = url.searchParams.get("storeId") ?? "";
  const prefix = (url.searchParams.get("prefix") ?? "").trim().toLowerCase();
  const store = resolveStore(storeId);
  if (!store || store.tenantId !== tenantId) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });
  if (!/^[a-z0-9_-]{2,24}$/.test(prefix)) return NextResponse.json({ error: "INVALID_PREFIX" }, { status: 400 });
  try {
    const connection = await getFreshStoreConnection(tenantId, storeId);
    const codes = new Set<string>();
    let after: string | null = null;
    for (let page = 0; page < 40; page++) {
      const result: CouponResponse = await shopifyAdminRequest<CouponResponse>({ shopDomain: store.domain, accessToken: connection.accessToken, query: QUERY, variables: { after, query: `method:code code:${prefix}*` } });
      for (const node of result.discountNodes.nodes) for (const entry of node.discount.codes?.nodes ?? []) {
        if (entry.code.toLowerCase().startsWith(prefix)) codes.add(entry.code);
      }
      if (!result.discountNodes.pageInfo.hasNextPage || !result.discountNodes.pageInfo.endCursor) break;
      after = result.discountNodes.pageInfo.endCursor;
    }
    return NextResponse.json({ codes: [...codes].sort() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "COUPON_SCAN_FAILED" }, { status: 502 });
  }
}
