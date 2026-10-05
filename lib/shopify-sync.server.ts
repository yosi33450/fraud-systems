import { completeHistoricalSync, exportCrediMatchChargebacks, failHistoricalSync, ingestShopifyOrder, openCaseOrderReferences, replaceGiftCardRegistry, restoreCrediMatchOrderCandidates, upsertGiftCardRegistry, type GiftCardRegistryInput, type ShopifyOrderPayload } from "@/lib/operational-store";
import { matchCrediMatchChargeback } from "@/lib/credimatch-matching";
import { paymentFingerprintsFromShopify, shopifyChargebackSearchQuery } from "@/lib/credimatch-matching";
import type { CrediMatchOrderCandidate, Store } from "@/lib/types";
import { shopifyAdminRequest } from "@/lib/shopify-admin.server";
import { selectCustomerEmail } from "@/lib/customer-identity";
import { syncGiftEvidenceForOrder } from "@/lib/gift-card-sync.server";
import { hydrateGiftEvidence } from "@/lib/gift-card-persistence.server";

export const ORDERS_BACKFILL_QUERY = `#graphql
  query ShieldLedgerOrdersBackfill($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        tags sourceName channelInformation { channelDefinition { channelName handle } }
        discountCodes
        createdAt
        displayFulfillmentStatus
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
        id gateway formattedGateway accountNumber authorizationCode kind status processedAt receiptJson
        paymentDetails { __typename ... on CardPaymentDetails { number company } }
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
            isGiftCard
            quantity
            originalUnitPriceSet { shopMoney { amount currencyCode } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const CREDIMATCH_ORDER_CANDIDATES_QUERY = `#graphql
  query CrediMatchOrderCandidates($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: false) {
      nodes {
        id
        name
        createdAt
        email
        totalPriceSet { shopMoney { amount currencyCode } }
        customer {
          firstName
          lastName
          defaultEmailAddress { emailAddress }
        }
        transactions {
          id
          gateway
          formattedGateway
          paymentId
          accountNumber
          authorizationCode
          processedAt
          receiptJson
          paymentDetails { __typename ... on CardPaymentDetails { number company } }
          amountSet { shopMoney { amount currencyCode } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const CREDIMATCH_TENDER_CANDIDATES_QUERY = `#graphql
  query CrediMatchTenderCandidates($first: Int!, $after: String, $query: String!) {
    tenderTransactions(first: $first, after: $after, query: $query) {
      nodes {
        order { id }
        amount { amount currencyCode }
        processedAt
        remoteReference
        paymentDetails: transactionDetails {
          ... on TenderTransactionCreditCardDetails { creditCardNumber }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const CREDIMATCH_ORDER_ACCESS_QUERY = `#graphql
  query CrediMatchOrderAccess {
    currentAppInstallation { accessScopes { handle } }
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
      id name createdAt email phone clientIp paymentGatewayNames tags sourceName channelInformation { channelDefinition { channelName handle } } discountCodes displayFulfillmentStatus
      risk { recommendation assessments { riskLevel facts { description sentiment } } }
      customAttributes { key value }
      transactions {
        id gateway formattedGateway accountNumber authorizationCode kind status processedAt receiptJson
        paymentDetails { __typename ... on CardPaymentDetails { number company } }
        amountSet { shopMoney { amount currencyCode } }
      }
      totalPriceSet { shopMoney { amount currencyCode } }
      customer { id firstName lastName defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } }
      billingAddress { firstName lastName address1 city province countryCodeV2 zip phone }
      shippingAddress { firstName lastName address1 city province countryCodeV2 zip phone }
      lineItems(first: 50) { nodes { name title isGiftCard quantity originalUnitPriceSet { shopMoney { amount currencyCode } } } }
    }
  }
`;

const OPEN_CASE_TAGS_QUERY = `#graphql
  query ShopShieldOpenCaseOrderTags($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order { id name tags sourceName channelInformation { channelDefinition { channelName handle } } }
    }
  }
`;

type ShopifyOrderNode = {
  id: string;
  name: string;
  tags?: string[];
  sourceName?: string | null;
  channelInformation?: { channelDefinition?: { channelName?: string | null; handle?: string | null } | null } | null;
  discountCodes?: string[];
  createdAt: string;
  displayFulfillmentStatus?: string;
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
    authorizationCode?: string | null;
    paymentDetails?: { __typename?: string; number?: string | null; company?: string | null } | null;
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
  lineItems: { nodes: Array<{ name: string; title: string; isGiftCard: boolean; quantity: number; originalUnitPriceSet: { shopMoney: { amount: string; currencyCode: string } } }> };
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
  tags: order.tags,
  source_name: [order.sourceName, order.channelInformation?.channelDefinition?.channelName, order.channelInformation?.channelDefinition?.handle].filter(Boolean).join(" "),
  discount_codes: order.discountCodes,
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
  shopify_risk_facts: order.risk?.recommendation?.toLowerCase() === "high"
    ? order.risk?.assessments.flatMap((assessment) => assessment.facts.filter((fact) => fact.sentiment === "NEGATIVE").map((fact) => fact.description)) ?? []
    : [],
  payment_failures: order.transactions.filter((transaction) => ["FAILURE", "ERROR"].includes(transaction.status?.toUpperCase())).length,
  transactions: order.transactions.map((transaction) => ({
    id: transaction.id,
    gateway: transaction.gateway ?? undefined,
    formatted_gateway: transaction.formattedGateway ?? undefined,
    account_number: transaction.accountNumber ?? undefined,
    payment_details: transaction.paymentDetails,
    authorization_code: transaction.authorizationCode ?? undefined,
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
    gift_card: item.isGiftCard,
    quantity: item.quantity,
    price: item.originalUnitPriceSet.shopMoney.amount,
  })),
});

/** Removes physical-store cases immediately, instead of waiting for a full historical replay. */
export async function reconcileOpenCaseExternalOrders(input: { tenantId: string; storeId: string; shopDomain: string; accessToken: string }) {
  const references = openCaseOrderReferences(input.tenantId, input.storeId);
  if (!references.length) return 0;
  const data = await shopifyAdminRequest<{ nodes: Array<{ id?: string; name?: string; tags?: string[]; sourceName?: string | null; channelInformation?: { channelDefinition?: { channelName?: string | null; handle?: string | null } | null } | null } | null> }>({
    shopDomain: input.shopDomain, accessToken: input.accessToken, query: OPEN_CASE_TAGS_QUERY,
    variables: { ids: references.map((reference) => reference.id) },
  });
  let excluded = 0;
  for (const order of data.nodes) {
    const sourceName = [order?.sourceName, order?.channelInformation?.channelDefinition?.channelName, order?.channelInformation?.channelDefinition?.handle].filter(Boolean).join(" ").toLowerCase();
    const isPhysicalStoreOrder = order?.tags?.some((tag) => tag.trim().toLowerCase() === "external-order") || /(?:^|[\s_-])pos(?:$|[\s_-])|point[\s_-]*of[\s_-]*sale/.test(sourceName);
    if (!order?.id || !isPhysicalStoreOrder) continue;
    ingestShopifyOrder({
      storeId: input.storeId, webhookId: `external-reconcile:${order.id}`, topic: "HISTORICAL_SYNC",
      payload: { id: order.id, admin_graphql_api_id: order.id, name: order.name, tags: order.tags, source_name: sourceName },
    });
    excluded += 1;
  }
  return excluded;
}

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

/** A bounded replay for the dashboard's manual refresh. Each page is persisted by the route. */
export async function syncOrdersPage(input: { tenantId: string; storeId: string; shopDomain: string; accessToken: string; since: string; after?: string | null; scanned: number }) {
  const data: OrdersBackfillResponse = await shopifyAdminRequest<OrdersBackfillResponse>({
    shopDomain: input.shopDomain,
    accessToken: input.accessToken,
    query: ORDERS_BACKFILL_QUERY.replace("reverse: true", "reverse: false"),
    variables: { first: 50, after: input.after ?? null, query: `created_at:>=${input.since}` },
  });
  let casesCreated = 0;
  for (const order of data.orders.nodes) {
    const result = ingestShopifyOrder({
      storeId: input.storeId,
      webhookId: `historical:${order.id}`,
      topic: "HISTORICAL_SYNC",
      payload: toPayload(order),
    });
    if (result.case) casesCreated += 1;
  }
  const scanned = input.scanned + data.orders.nodes.length;
  const nextCursor = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
  if (data.orders.pageInfo.hasNextPage && !nextCursor) throw new Error("SHOPIFY_SYNC_CURSOR_MISSING");
  const store = nextCursor ? null : completeHistoricalSync(input.tenantId, input.storeId, scanned, data.orders.nodes.at(-1)?.createdAt);
  return { scanned, casesCreated, nextCursor, complete: !nextCursor, store };
}

type CrediMatchOrderCandidateNode = {
  id: string;
  name: string;
  createdAt: string;
  email?: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer?: {
    firstName?: string | null;
    lastName?: string | null;
    defaultEmailAddress?: { emailAddress: string } | null;
  } | null;
  transactions: Array<{
    id: string;
    gateway?: string | null;
    formattedGateway?: string | null;
    paymentId?: string | null;
    accountNumber?: string | null;
    authorizationCode?: string | null;
    paymentDetails?: { __typename?: string; number?: string | null; company?: string | null } | null;
    processedAt?: string | null;
    receiptJson?: unknown;
    amountSet: { shopMoney: { amount: string; currencyCode: string } };
  }>;
};

type TenderTransactionNode = {
  order?: { id: string } | null;
  amount: { amount: string; currencyCode: string };
  processedAt?: string | null;
  remoteReference?: string | null;
  paymentDetails?: { creditCardNumber?: string | null } | null;
};

async function tenderFingerprintsForOrders(input: {
  shopDomain: string;
  accessToken: string;
  orders: CrediMatchOrderCandidateNode[];
}) {
  const byOrder = new Map<string, CrediMatchOrderCandidate["payments"]>();
  if (!input.orders.length) return byOrder;
  const times = input.orders.map((order) => Date.parse(order.createdAt)).filter(Number.isFinite);
  if (!times.length) return byOrder;
  const padding = 3 * 86_400_000;
  const since = new Date(Math.min(...times) - padding).toISOString();
  const until = new Date(Math.max(...times) + padding).toISOString();
  const wantedOrders = new Set(input.orders.map((order) => order.id));
  let after: string | null = null;
  let scanned = 0;
  let remoteReferences = 0;
  let cardSuffixes = 0;

  do {
    const data: {
      tenderTransactions: {
        nodes: TenderTransactionNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await shopifyAdminRequest({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
      query: CREDIMATCH_TENDER_CANDIDATES_QUERY,
      variables: { first: 250, after, query: `processed_at:>=${since} processed_at:<=${until}` },
    });
    scanned += data.tenderTransactions.nodes.length;
    for (const tender of data.tenderTransactions.nodes) {
      const orderId = tender.order?.id;
      if (!orderId || !wantedOrders.has(orderId)) continue;
      if (tender.remoteReference) remoteReferences += 1;
      if (tender.paymentDetails?.creditCardNumber) cardSuffixes += 1;
      const [fingerprint] = paymentFingerprintsFromShopify([{
        // Shopify exposes PayPlus' opaque merchant reference as the tender
        // remote reference. Preserve it as `more_info`, not as a generic
        // gateway id, so it can be compared directly with PayPlus.
        receipt: { more_info: tender.remoteReference ?? undefined },
        payment_details: { number: tender.paymentDetails?.creditCardNumber },
        amount: tender.amount.amount,
        processed_at: tender.processedAt ?? undefined,
      }], tender.amount.currencyCode);
      byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), fingerprint]);
    }
    after = data.tenderTransactions.pageInfo.hasNextPage ? data.tenderTransactions.pageInfo.endCursor : null;
    if (data.tenderTransactions.pageInfo.hasNextPage && !after) throw new Error("SHOPIFY_TENDER_CURSOR_MISSING");
  } while (after);

  console.info("[credimatch-backfill] Shopify tender field coverage", {
    tenderTransactions: scanned,
    matchedOrders: byOrder.size,
    remoteReferences,
    cardSuffixes,
  });
  return byOrder;
}

/**
 * Fetches one small page for chargeback matching only. These projections do
 * not pass through ingestShopifyOrder, so they never create cases or appear in
 * operational order and employee activity views.
 */
export async function syncCrediMatchOrderCandidatesPage(input: {
  tenantId: string;
  storeId: string;
  shopDomain: string;
  accessToken: string;
  since: string;
  until: string;
  after?: string | null;
  scanned: number;
  searchQuery?: string;
  includeTender?: boolean;
}) {
  if (!input.after && Date.parse(input.since) < Date.now() - 60 * 86_400_000) {
    const access = await shopifyAdminRequest<{ currentAppInstallation: { accessScopes: Array<{ handle: string }> } }>({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
      query: CREDIMATCH_ORDER_ACCESS_QUERY,
    });
    if (!access.currentAppInstallation.accessScopes.some((scope) => scope.handle === "read_all_orders")) {
      throw new Error("SHOPIFY_READ_ALL_ORDERS_REQUIRED");
    }
  }

  const data = await shopifyAdminRequest<{
    orders: { nodes: CrediMatchOrderCandidateNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
  }>({
    shopDomain: input.shopDomain,
    accessToken: input.accessToken,
    query: CREDIMATCH_ORDER_CANDIDATES_QUERY,
    variables: {
      first: 200,
      after: input.after ?? null,
      query: input.searchQuery ?? shopifyChargebackSearchQuery({
        since: input.since,
        until: input.until,
        chargebacks: exportCrediMatchChargebacks().filter((item) => item.tenantId === input.tenantId),
      }),
    },
  });

  const candidates: CrediMatchOrderCandidate[] = data.orders.nodes.map((order) => ({
    tenantId: input.tenantId,
    storeId: input.storeId,
    shopifyOrderId: order.id,
    orderNumber: order.name,
    customer: [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(" ") || undefined,
    email: selectCustomerEmail({
      orderEmail: order.email,
      customerEmail: order.customer?.defaultEmailAddress?.emailAddress,
    }),
    amount: Number(order.totalPriceSet.shopMoney.amount),
    currency: order.totalPriceSet.shopMoney.currencyCode,
    createdAt: order.createdAt,
    payments: paymentFingerprintsFromShopify(order.transactions.map((transaction) => ({
        id: transaction.id,
        payment_id: transaction.paymentId ?? undefined,
        gateway: transaction.gateway ?? undefined,
        formatted_gateway: transaction.formattedGateway ?? undefined,
        account_number: transaction.accountNumber ?? undefined,
        payment_details: transaction.paymentDetails,
        authorization_code: transaction.authorizationCode ?? undefined,
        amount: transaction.amountSet.shopMoney.amount,
        processed_at: transaction.processedAt ?? undefined,
        receipt: transaction.receiptJson,
      })), order.totalPriceSet.shopMoney.currencyCode),
  }));
  if (!input.after) {
    const transactions = data.orders.nodes.flatMap((order) => order.transactions);
    const receiptKeys = new Set<string>();
    const receiptPaymentIds: string[] = [];
    for (const transaction of transactions) {
      let receipt: unknown = transaction.receiptJson;
      if (typeof receipt === "string") {
        try { receipt = JSON.parse(receipt); } catch { receipt = undefined; }
      }
      if (receipt && typeof receipt === "object" && !Array.isArray(receipt)) {
        const receiptRecord = receipt as Record<string, unknown>;
        for (const key of Object.keys(receiptRecord).slice(0, 40)) receiptKeys.add(key);
        const receiptPaymentId = receiptRecord.payment_id;
        if (typeof receiptPaymentId === "string" || typeof receiptPaymentId === "number") {
          receiptPaymentIds.push(String(receiptPaymentId));
        }
      }
    }
    const normalizeDiagnosticId = (value: unknown) => String(value ?? "").replace(/[^a-z0-9]/gi, "").replace(/^0+(?=\d)/, "").toLowerCase();
    const chargebacks = exportCrediMatchChargebacks().filter((item) => item.tenantId === input.tenantId);
    const crediMatchTransactionIds = new Set(chargebacks.map((item) => normalizeDiagnosticId(item.transactionId)).filter(Boolean));
    const crediMatchConfirmationNumbers = new Set(chargebacks.map((item) => normalizeDiagnosticId(item.confirmationNumber)).filter(Boolean));
    const crediMatchVoucherNumbers = new Set(chargebacks.map((item) => normalizeDiagnosticId(item.voucherNumber)).filter(Boolean));
    const crediMatchProviderUids = new Set(chargebacks.map((item) => normalizeDiagnosticId(item.providerUid)).filter(Boolean));
    const shopifyPaymentIds = transactions.map((item) => item.paymentId).filter((value): value is string => Boolean(value));
    const identifierMatches = (values: string[], expected: Set<string>) => values.filter((value) => expected.has(normalizeDiagnosticId(value))).length;
    console.info("[credimatch-backfill] Shopify payment field coverage", {
      orders: data.orders.nodes.length,
      transactions: transactions.length,
      accountNumber: transactions.filter((item) => Boolean(item.accountNumber)).length,
      cardPaymentDetails: transactions.filter((item) => item.paymentDetails?.__typename === "CardPaymentDetails").length,
      paymentDetailsNumber: transactions.filter((item) => Boolean(item.paymentDetails?.number)).length,
      extractedLast4: candidates.filter((item) => item.payments?.some((payment) => Boolean(payment.last4))).length,
      paymentId: shopifyPaymentIds.length,
      receiptPaymentId: receiptPaymentIds.length,
      paymentIdMatchesCrediMatchTransaction: identifierMatches(shopifyPaymentIds, crediMatchTransactionIds),
      paymentIdMatchesCrediMatchConfirmation: identifierMatches(shopifyPaymentIds, crediMatchConfirmationNumbers),
      paymentIdMatchesCrediMatchVoucher: identifierMatches(shopifyPaymentIds, crediMatchVoucherNumbers),
      paymentIdMatchesCrediMatchUid: identifierMatches(shopifyPaymentIds, crediMatchProviderUids),
      receiptPaymentIdMatchesCrediMatchTransaction: identifierMatches(receiptPaymentIds, crediMatchTransactionIds),
      receiptPaymentIdMatchesCrediMatchConfirmation: identifierMatches(receiptPaymentIds, crediMatchConfirmationNumbers),
      receiptPaymentIdMatchesCrediMatchVoucher: identifierMatches(receiptPaymentIds, crediMatchVoucherNumbers),
      receiptPaymentIdMatchesCrediMatchUid: identifierMatches(receiptPaymentIds, crediMatchProviderUids),
      receiptKeys: [...receiptKeys].slice(0, 40),
    });
  }
  if (input.includeTender && candidates.length) {
    const tenderByOrder = await tenderFingerprintsForOrders({
      shopDomain: input.shopDomain, accessToken: input.accessToken, orders: data.orders.nodes,
    });
    for (const candidate of candidates) {
      candidate.payments = [...(candidate.payments ?? []), ...(tenderByOrder.get(candidate.shopifyOrderId) ?? [])];
    }
  }
  const chargebacks = exportCrediMatchChargebacks().filter((item) => item.tenantId === input.tenantId);
  restoreCrediMatchOrderCandidates(candidates.filter((candidate) =>
    chargebacks.some((chargeback) => matchCrediMatchChargeback(chargeback, [candidate]).confidence !== "unmatched")));

  const scanned = input.scanned + candidates.length;
  const nextCursor = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
  if (data.orders.pageInfo.hasNextPage && !nextCursor) throw new Error("SHOPIFY_SYNC_CURSOR_MISSING");
  return { scanned, nextCursor, complete: !nextCursor };
}

export async function syncShopifyOrderGiftCards(input: { tenantId: string; storeId: string; shopDomain: string; accessToken: string; orderId: string; webhookId: string; topic: string }) {
  const data = await shopifyAdminRequest<{ order: ShopifyOrderNode | null }>({
    shopDomain: input.shopDomain,
    accessToken: input.accessToken,
    query: ORDER_GIFT_CARD_DETAILS_QUERY,
    variables: { id: input.orderId },
  });
  if (!data.order) throw new Error("SHOPIFY_ORDER_NOT_FOUND");
  if (data.order.tags?.some((tag) => tag.trim().toLowerCase() === "external-order")) {
    return ingestShopifyOrder({ storeId: input.storeId, webhookId: input.webhookId, topic: input.topic, payload: toPayload(data.order) });
  }
  const containsGiftCard = data.order.lineItems.nodes.some((item) => item.isGiftCard)
    || data.order.transactions.some((transaction) => /gift.?card/i.test(`${transaction.gateway ?? ""} ${transaction.formattedGateway ?? ""}`));
  if (containsGiftCard) {
    await hydrateGiftEvidence(input.tenantId);
    await syncGiftEvidenceForOrder(input, input.orderId);
  }
  const payload = toPayload(data.order);
  if (input.topic === "refunds/create") payload.refund_after_fulfillment = data.order.displayFulfillmentStatus === "FULFILLED";
  return ingestShopifyOrder({ storeId: input.storeId, webhookId: input.webhookId, topic: input.topic, payload });
}
