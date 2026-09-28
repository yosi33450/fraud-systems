import { NextResponse } from "next/server";
import { resolveStore } from "@/lib/operational-store";
import { hydrateOperationalState } from "@/lib/persistence.server";
import { getFreshStoreConnection } from "@/lib/shopify-connection.server";
import { shopifyAdminRequest } from "@/lib/shopify-admin.server";

export const dynamic = "force-dynamic";

const ACCESS_QUERY = `#graphql
  query ShopShieldDiscountAccess {
    currentAppInstallation { accessScopes { handle } }
  }
`;
const DETAILS_QUERY = `#graphql
  query ShopShieldCouponDetails($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          title summary status startsAt endsAt asyncUsageCount usageLimit
          codes(first: 10, query: $code) { nodes { code asyncUsageCount } }
        }
        ... on DiscountCodeBxgy {
          title summary status startsAt endsAt asyncUsageCount usageLimit
          codes(first: 10, query: $code) { nodes { code asyncUsageCount } }
        }
        ... on DiscountCodeFreeShipping {
          title summary status startsAt endsAt asyncUsageCount usageLimit
          codes(first: 10, query: $code) { nodes { code asyncUsageCount } }
        }
        ... on DiscountCodeApp {
          title status startsAt endsAt asyncUsageCount usageLimit
          codes(first: 10, query: $code) { nodes { code asyncUsageCount } }
        }
      }
    }
  }
`;

type DiscountDetails = {
  __typename: string;
  title?: string;
  summary?: string;
  status?: string;
  startsAt?: string;
  endsAt?: string | null;
  asyncUsageCount?: number;
  usageLimit?: number | null;
  codes?: { nodes: Array<{ code: string; asyncUsageCount: number }> };
};

export async function GET(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  await hydrateOperationalState();
  const { tenantId } = await context.params;
  const url = new URL(request.url);
  const storeId = url.searchParams.get("storeId") ?? "";
  const code = (url.searchParams.get("code") ?? "").trim();
  const store = resolveStore(storeId);
  if (!store || store.tenantId !== tenantId) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });
  if (code.length > 255) return NextResponse.json({ error: "INVALID_CODE" }, { status: 400 });
  try {
    const connection = await getFreshStoreConnection(tenantId, storeId);
    const access = await shopifyAdminRequest<{ currentAppInstallation: { accessScopes: Array<{ handle: string }> } }>({
      shopDomain: store.domain, accessToken: connection.accessToken, query: ACCESS_QUERY,
    });
    const readDiscounts = access.currentAppInstallation.accessScopes.some((scope) => scope.handle === "read_discounts");
    if (!readDiscounts || !code) return NextResponse.json({ readDiscounts, found: false }, { headers: { "Cache-Control": "no-store" } });
    const result = await shopifyAdminRequest<{ codeDiscountNodeByCode: { id: string; codeDiscount: DiscountDetails } | null }>({
      shopDomain: store.domain, accessToken: connection.accessToken, query: DETAILS_QUERY, variables: { code },
    });
    const node = result.codeDiscountNodeByCode;
    if (!node) return NextResponse.json({ readDiscounts, found: false }, { headers: { "Cache-Control": "no-store" } });
    const discount = node.codeDiscount;
    const exactCode = discount.codes?.nodes.find((item) => item.code.toLowerCase() === code.toLowerCase());
    return NextResponse.json({ readDiscounts, found: true, details: {
      id: node.id, type: discount.__typename, title: discount.title ?? "", summary: discount.summary ?? "",
      status: discount.status ?? "", startsAt: discount.startsAt ?? null, endsAt: discount.endsAt ?? null,
      usageLimit: discount.usageLimit ?? null, shopifyDiscountUses: discount.asyncUsageCount ?? null,
      shopifyCodeUses: exactCode?.asyncUsageCount ?? null,
    } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("[coupon-details] Shopify details unavailable", { tenantId, storeId, category: error instanceof Error && /access|scope|permission/i.test(error.message) ? "permission" : "connection" });
    return NextResponse.json({ error: "SHOPIFY_DETAILS_UNAVAILABLE" }, { status: 502 });
  }
}
