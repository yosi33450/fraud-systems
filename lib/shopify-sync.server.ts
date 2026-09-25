import { completeHistoricalSync, failHistoricalSync, ingestShopifyOrder, replaceGiftCardRegistry, upsertGiftCardRegistry, type GiftCardRegistryInput, type ShopifyOrderPayload } from "@/lib/operational-store";
import type { Store } from "@/lib/types";
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
      transactions {
        id gateway formattedGateway accountNumber kind status processedAt receiptJson
        amountSet { shopMoney { amount currencyCode } }
      }
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

export const GIFT_CARDS_QUERY = `#graphql
  query ShieldLedgerGiftCards($first: Int!, $after: String, $query: String!) {
    giftCards(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id maskedCode lastCharacters
        initialValue { amount currencyCode }
        balance { amount currencyCode }
        order { id name }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const ORDER_GIFT_CARD_DETAILS_QUERY = `#graphql
  query ShieldLedgerOrderGiftCardDetails($id: ID!) {
    order(id: $id) {
      id name createdAt email phone clientIp paymentGatewayNames
      risk { recommendation assessments { riskLevel facts { description sentiment } } }
      customAttributes { key value }
      transactions {
        id gateway formattedGateway accountNumber kind status processedAt receiptJson
        amountSet { shopMoney { amount currencyCode } }
      }
      totalPriceSet { shopMoney { amount currencyCode } }
      customer { id firstName lastName defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } }
      billingAddress { firstName lastName address1 city province countryCodeV2 zip phone }
      shippingAddress { firstName lastName address1 city province countryCodeV2 zip phone }
      lineItems(first: 50) { nodes { name title quantity originalUnitPriceSet { shopMoney { amount currencyCode } } } }
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
  transactions: Array<{
    id: string; gateway?: string | null; formattedGateway?: string | null; accountNumber?: string | null;
    kind: string; status: string; processedAt?: string | null; receiptJson?: unknown;
    amountSet: { shopMoney: { amount: string; currencyCode: string } };
  }>;
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
  transactions: order.transactions.map((transaction) => ({
    id: transaction.id,
    gateway: transaction.gateway ?? undefined,
    formatted_gateway: transaction.formattedGateway ?? undefined,
    account_number: transaction.accountNumber ?? undefined,
    amount: transaction.amountSet.shopMoney.amount,
    status: transaction.status,
    kind: transaction.kind,
    processed_at: transaction.processedAt ?? undefined,
    receipt: transaction.receiptJson,
  })),
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

const giftCardTrackingStatus = (error: unknown): NonNullable<Store["giftCardTrackingStatus"]> => {
  const message = error instanceof Error ? error.message : String(error);
  return /access denied for giftcards|read_gift_cards/i.test(message) ? "shopify-approval-required" : "unavailable";
};

async function syncGiftCardRegistry(
  input: { tenantId: string; storeId: string; shopDomain: string; accessToken: string },
  options: { since: string; replace: boolean },
) {
  let after: string | null = null;
  const cards: GiftCardRegistryInput[] = [];
  do {
    const data: {
      giftCards: {
        nodes: Array<{
          id: string; maskedCode: string; lastCharacters: string;
          initialValue: { amount: string }; balance: { amount: string };
          order?: { id: string; name: string } | null;
        }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await shopifyAdminRequest({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
      query: GIFT_CARDS_QUERY,
      variables: { first: 100, after, query: `created_at:>=${options.since}` },
    });
    cards.push(...data.giftCards.nodes.map((card) => ({
      giftCardId: card.id,
      maskedCode: card.maskedCode,
      lastCharacters: card.lastCharacters,
      initialValue: Number(card.initialValue.amount),
      balance: Number(card.balance.amount),
      purchaseOrderId: card.order?.id,
      purchaseOrderNumber: card.order?.name,
    })));
    after = data.giftCards.pageInfo.hasNextPage ? data.giftCards.pageInfo.endCursor : null;
  } while (after);
  if (options.replace) replaceGiftCardRegistry(input.tenantId, input.storeId, cards);
  else upsertGiftCardRegistry(input.tenantId, input.storeId, cards);
  return cards.length;
}

export async function syncOrdersLast30Days(input: { tenantId: string; storeId: string; shopDomain: string; accessToken: string }) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  let after: string | null = null;
  const orders: ShopifyOrderNode[] = [];

  try {
    let giftCardsTracked = 0;
    let giftCardTracking: NonNullable<Store["giftCardTrackingStatus"]> = "active";
    try {
      giftCardsTracked = await syncGiftCardRegistry(input, { since, replace: true });
    } catch (error) {
      giftCardTracking = giftCardTrackingStatus(error);
      console.warn("[shopify-sync] gift card registry unavailable", error instanceof Error ? error.message : error);
    }
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
    const store = completeHistoricalSync(input.tenantId, input.storeId, orders.length, orders.at(-1)?.createdAt, { status: giftCardTracking, tracked: giftCardsTracked });
    return { scanned: orders.length, casesCreated, since, store, giftCardsTracked, giftCardTracking };
  } catch (error) {
    failHistoricalSync(input.tenantId, input.storeId);
    throw error;
  }
}

export async function syncShopifyOrderGiftCards(input: { tenantId: string; storeId: string; shopDomain: string; accessToken: string; orderId: string; webhookId: string; topic: string }) {
  const data = await shopifyAdminRequest<{ order: ShopifyOrderNode | null }>({
    shopDomain: input.shopDomain,
    accessToken: input.accessToken,
    query: ORDER_GIFT_CARD_DETAILS_QUERY,
    variables: { id: input.orderId },
  });
  if (!data.order) throw new Error("SHOPIFY_ORDER_NOT_FOUND");
  const containsGiftCard = data.order.lineItems.nodes.some((item) => /gift\s*card|כרטיס\s*מתנה/i.test(`${item.name} ${item.title}`))
    || data.order.transactions.some((transaction) => /gift.?card/i.test(`${transaction.gateway ?? ""} ${transaction.formattedGateway ?? ""}`));
  if (containsGiftCard) {
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
    try { await syncGiftCardRegistry(input, { since, replace: false }); } catch (error) {
      console.warn("[shopify-sync] live gift card registry refresh unavailable", error instanceof Error ? error.message : error);
    }
  }
  return ingestShopifyOrder({ storeId: input.storeId, webhookId: input.webhookId, topic: input.topic, payload: toPayload(data.order) });
}
