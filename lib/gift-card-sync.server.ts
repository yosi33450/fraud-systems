import { shopifyAdminRequest } from "@/lib/shopify-admin.server";
import { recordGiftCardOrderEvidence, refreshOrderEvidenceLinks } from "@/lib/operational-store";
import { extractGiftUses, extractIssuances, type GiftCardOrderEvidence } from "@/lib/gift-card-evidence";
import { selectCustomerEmail } from "@/lib/customer-identity";
import { persistGiftEvidence } from "@/lib/gift-card-persistence.server";

type Connection = { tenantId: string; storeId: string; shopDomain: string; accessToken: string };
const fields = `id name createdAt email customAttributes { key value }
  customer { id firstName lastName defaultEmailAddress { emailAddress } }
  shippingAddress { firstName lastName } billingAddress { firstName lastName }
  lineItems(first: 100) { nodes { isGiftCard quantity } pageInfo { hasNextPage } }
  transactions(first: 250) { id gateway kind status processedAt receiptJson amountSet { shopMoney { amount currencyCode } } }`;
export const GIFT_ORDER_QUERY = `query GiftLedgerOrder($id: ID!) { order(id: $id) { ${fields} } }`;
export const GIFT_SCAN_QUERY = `query GiftLedgerScan($after: String, $query: String!) {
  orders(first: 25, after: $after, query: $query, sortKey: CREATED_AT) {
    nodes { ${fields} } pageInfo { hasNextPage endCursor }
  }
}`;
export const GIFT_EVENTS_QUERY = `query GiftLedgerIssuance($id: ID!, $after: String) {
  order(id: $id) { events(first: 100, after: $after) {
    nodes { id action createdAt ... on BasicEvent { additionalContent } }
    pageInfo { hasNextPage endCursor }
  } }
}`;
type GiftOrder = {
  id: string; name: string; createdAt: string; email?: string;
  customAttributes: Array<{ key: string; value: string }>;
  customer?: { id: string; firstName?: string; lastName?: string; defaultEmailAddress?: { emailAddress: string } };
  shippingAddress?: { firstName?: string; lastName?: string }; billingAddress?: { firstName?: string; lastName?: string };
  lineItems: { nodes: Array<{ isGiftCard: boolean; quantity: number }>; pageInfo: { hasNextPage: boolean } };
  transactions: Parameters<typeof extractGiftUses>[0];
};
type Events = { nodes: Parameters<typeof extractIssuances>[0]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

async function evidenceForOrder(connection: Connection, order: GiftOrder) {
  const giftCardUnits = order.lineItems.nodes.reduce((sum, item) => sum + (item.isGiftCard ? item.quantity : 0), 0);
  const parsed = extractGiftUses(order.transactions, order.createdAt);
  if (!giftCardUnits && !parsed.uses.length && !parsed.unidentifiedTransactions) return null;
  const events: Events["nodes"] = [];
  let after: string | null = null;
  let pages = 0;
  if (giftCardUnits) do {
    const result: { order: { events: Events } | null } = await shopifyAdminRequest({ ...connection,
      query: GIFT_EVENTS_QUERY, variables: { id: order.id, after } });
    if (!result.order) throw new Error("SHOPIFY_ORDER_NOT_FOUND");
    events.push(...result.order.events.nodes);
    after = result.order.events.pageInfo.hasNextPage ? result.order.events.pageInfo.endCursor : null;
    pages++;
  } while (after && pages < 5);
  const email = selectCustomerEmail({ orderEmail: order.email, customerEmail: order.customer?.defaultEmailAddress?.emailAddress, customAttributes: order.customAttributes });
  const address = order.shippingAddress ?? order.billingAddress;
  const name = [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(" ");
  const addressName = [address?.firstName, address?.lastName].filter(Boolean).join(" ");
  const evidence: GiftCardOrderEvidence = {
    tenantId: connection.tenantId, storeId: connection.storeId, orderId: order.id, orderNumber: order.name,
    customer: /general customer payplus/i.test(name) ? addressName || "פרטי הקונה לא הועברו" : name || addressName || "פרטי הקונה לא הועברו",
    email: email.toLowerCase(), customerId: order.customer?.id, createdAt: order.createdAt,
    checkedAt: new Date().toISOString(), giftCardUnits, issued: extractIssuances(events), ...parsed,
    complete: !after && !order.lineItems.pageInfo.hasNextPage && order.transactions.length < 250,
  };
  return evidence;
}

export async function syncGiftEvidenceForOrder(connection: Connection, orderId: string) {
  const result = await shopifyAdminRequest<{ order: GiftOrder | null }>({ ...connection, query: GIFT_ORDER_QUERY, variables: { id: orderId } });
  if (!result.order) throw new Error("SHOPIFY_ORDER_NOT_FOUND");
  const evidence = await evidenceForOrder(connection, result.order);
  if (evidence) {
    recordGiftCardOrderEvidence(evidence);
    await persistGiftEvidence(connection.tenantId, connection.storeId, [evidence]);
  }
  return evidence;
}

export async function scanGiftEvidencePage(connection: Connection, after: string | null, since: string, until: string) {
  const result = await shopifyAdminRequest<{ orders: { nodes: GiftOrder[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>({
    ...connection, query: GIFT_SCAN_QUERY, variables: { after, query: `created_at:>=${since} created_at:<=${until}` },
  });
  // Apply a page only after all reads succeed. Retrying a page is idempotent.
  const evidence: GiftCardOrderEvidence[] = [];
  for (const order of result.orders.nodes) {
    const parsed = await evidenceForOrder(connection, order);
    if (parsed) evidence.push(parsed);
  }
  for (const item of evidence) recordGiftCardOrderEvidence(item, false);
  if (evidence.length) refreshOrderEvidenceLinks(connection.storeId);
  await persistGiftEvidence(connection.tenantId, connection.storeId, evidence);
  return { scanned: result.orders.nodes.length, relevant: evidence.length,
    after: result.orders.pageInfo.hasNextPage ? result.orders.pageInfo.endCursor : null };
}
