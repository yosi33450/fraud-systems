import { completeHistoricalSync, failHistoricalSync, ingestShopifyOrder, type ShopifyOrderPayload } from "@/lib/operational-store";
import { shopifyAdminRequest } from "@/lib/shopify-admin.server";
import { selectCustomerEmail } from "@/lib/customer-identity";

export const ORDERS_BACKFILL_QUERY = `#graphql
  query ShieldLedgerOrdersBackfill($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        createdAt
        email
      phone
      clientIp
      paymentGatewayNames
      risk {
        recommendation
        assessments {
          riskLevel
          facts { description sentiment }
        }
      }
      customAttributes { key value }
        totalPriceSet { shopMoney { amount currencyCode } }
      customer {
        id
          firstName
          lastName
          defaultEmailAddress { emailAddress }
          defaultPhoneNumber { phoneNumber }
        }
      billingAddress { firstName lastName address1 city province countryCodeV2 zip phone }
      shippingAddress { firstName lastName address1 city province countryCodeV2 zip phone }
        lineItems(first: 50) {
          nodes {
            name
            title
            quantity
            originalUnitPriceSet { shopMoney { amount currencyCode } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

type ShopifyOrderNode = {
  id: string;
  name: string;
  createdAt: string;
  email?: string | null;
  phone?: string | null;
  clientIp?: string | null;
  paymentGatewayNames: string[];
  risk?: {
    recommendation?: string | null;
    assessments: Array<{ riskLevel: string; facts: Array<{ description: string; sentiment: string }> }>;
  } | null;
  customAttributes: Array<{ key: string; value: string }>;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    defaultEmailAddress?: { emailAddress: string } | null;
    defaultPhoneNumber?: { phoneNumber: string } | null;
  } | null;
  billingAddress?: { firstName?: string | null; lastName?: string | null; address1?: string | null; city?: string | null; province?: string | null; countryCodeV2?: string | null; zip?: string | null; phone?: string | null } | null;
  shippingAddress?: { firstName?: string | null; lastName?: string | null; address1?: string | null; city?: string | null; province?: string | null; countryCodeV2?: string | null; zip?: string | null; phone?: string | null } | null;
  lineItems: { nodes: Array<{ name: string; title: string; quantity: number; originalUnitPriceSet: { shopMoney: { amount: string; currencyCode: string } } }> };
};

type OrdersBackfillResponse = {
  orders: { nodes: ShopifyOrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
};

const address = (value: ShopifyOrderNode["billingAddress"]) => value ? {
  first_name: value.firstName ?? undefined,
  last_name: value.lastName ?? undefined,
  address1: value.address1 ?? undefined,
  city: value.city ?? undefined,
  province: value.province ?? undefined,
  country_code: value.countryCodeV2 ?? undefined,
  zip: value.zip ?? undefined,
  phone: value.phone ?? undefined,
} : undefined;

const toPayload = (order: ShopifyOrderNode): ShopifyOrderPayload => ({
  id: order.id,
  admin_graphql_api_id: order.id,
  name: order.name,
  created_at: order.createdAt,
  email: selectCustomerEmail({
    orderEmail: order.email,
    customerEmail: order.customer?.defaultEmailAddress?.emailAddress,
    customAttributes: order.customAttributes,
  }) || order.email || undefined,
  phone: order.phone ?? order.customer?.defaultPhoneNumber?.phoneNumber ?? undefined,
  total_price: order.totalPriceSet.shopMoney.amount,
  currency: order.totalPriceSet.shopMoney.currencyCode,
  client_ip: order.clientIp ?? undefined,
  gateway_names: order.paymentGatewayNames,
  risk_level: order.risk?.recommendation?.toLowerCase() === "high" ? "high"
    : order.risk?.recommendation?.toLowerCase() === "medium" ? "medium"
      : order.risk?.recommendation?.toLowerCase() === "low" ? "low" : "none",
  shopify_risk_facts: order.risk?.assessments.flatMap((assessment) => assessment.facts.filter((fact) => fact.sentiment === "NEGATIVE").map((fact) => fact.description)) ?? [],
  customer: {
    admin_graphql_api_id: order.customer?.id,
    first_name: order.customer?.firstName ?? undefined,
    last_name: order.customer?.lastName ?? undefined,
    email: order.customer?.defaultEmailAddress?.emailAddress ?? undefined,
    phone: order.customer?.defaultPhoneNumber?.phoneNumber ?? undefined,
  },
  billing_address: address(order.billingAddress),
  shipping_address: address(order.shippingAddress),
  line_items: order.lineItems.nodes.map((item) => ({
    name: item.name,
    title: item.title,
    quantity: item.quantity,
    price: item.originalUnitPriceSet.shopMoney.amount,
  })),
});

export async function syncOrdersLast30Days(input: { tenantId: string; storeId: string; shopDomain: string; accessToken: string }) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  let after: string | null = null;
  const orders: ShopifyOrderNode[] = [];

  try {
    do {
      const data: OrdersBackfillResponse = await shopifyAdminRequest<OrdersBackfillResponse>({
        shopDomain: input.shopDomain,
        accessToken: input.accessToken,
        query: ORDERS_BACKFILL_QUERY,
        variables: { first: 50, after, query: `created_at:>=${since}` },
      });
      orders.push(...data.orders.nodes);
      after = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
    } while (after);

    orders.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
    let casesCreated = 0;
    for (const order of orders) {
      const result = ingestShopifyOrder({
        storeId: input.storeId,
        webhookId: `historical:${order.id}`,
        topic: "HISTORICAL_SYNC",
        payload: toPayload(order),
      });
      if (result.case) casesCreated += 1;
    }
    const store = completeHistoricalSync(input.tenantId, input.storeId, orders.length, orders.at(-1)?.createdAt);
    return { scanned: orders.length, casesCreated, since, store };
  } catch (error) {
    failHistoricalSync(input.tenantId, input.storeId);
    throw error;
  }
}
