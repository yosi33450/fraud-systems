// Keep this module independent of server state: evidence can be tested without customer data.
export type GiftOrderIdentity = {
  orderId: string; orderNumber: string; customer: string; email: string;
  customerId?: string; createdAt: string;
};
export type GiftIssuance = { giftCardId: string; lastCharacters: string; eventId: string; issuedAt: string };
export type GiftUse = {
  giftCardId: string; lastCharacters: string; transactionId: string;
  amount: number; currency: string; processedAt: string; kind: "SALE" | "CAPTURE" | "REFUND";
};
export type GiftCardOrderEvidence = GiftOrderIdentity & {
  tenantId: string; storeId: string; checkedAt: string; giftCardUnits: number;
  issued: GiftIssuance[]; uses: GiftUse[]; unidentifiedTransactions: number;
  complete: boolean;
};
export type GiftLedgerCard = {
  key: string; storeId: string; giftCardId: string; lastCharacters: string;
  purchase?: GiftOrderIdentity & { eventId: string; issuedAt: string };
  uses: Array<GiftUse & { order: GiftOrderIdentity }>;
  purchaseConflict: boolean;
};
export type GiftLedger = { cards: GiftLedgerCard[]; orders: GiftCardOrderEvidence[] };

export function hasFlaggedGiftSource(cards: GiftLedgerCard[], storeId: string, orderId: string, sources: Array<{ storeId: string; orderId?: string; status: string }>) {
  const flagged = new Set(sources.filter((source) => source.storeId === storeId && ["new", "review", "action", "fraud"].includes(source.status)).map((source) => source.orderId));
  return cards.some((card) => card.storeId === storeId && !card.purchaseConflict && card.purchase && flagged.has(card.purchase.orderId)
    && card.uses.some((use) => use.order.orderId === orderId && use.kind !== "REFUND" && Boolean(
      (card.purchase!.email && use.order.email && card.purchase!.email.toLowerCase() !== use.order.email.toLowerCase())
      || (card.purchase!.customerId && use.order.customerId && card.purchase!.customerId !== use.order.customerId)
    )));
}

export function normalizeGiftCardId(value: unknown): string | undefined {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return undefined;
  const match = String(value ?? "").match(/^(?:gid:\/\/shopify\/GiftCard\/)?([1-9]\d*)$/);
  return match ? `gid://shopify/GiftCard/${match[1]}` : undefined;
}

function visit(value: unknown, fn: (value: string | Record<string, unknown>) => void, depth = 0) {
  if (depth > 40 || value == null) return;
  if (typeof value === "string") {
    fn(value);
    if (/^[\s]*[\[{]/.test(value)) { try { visit(JSON.parse(value), fn, depth + 1); } catch { /* Unstructured content is not evidence. */ } }
  } else if (Array.isArray(value)) value.forEach((item) => visit(item, fn, depth + 1));
  else if (typeof value === "object") {
    fn(value as Record<string, unknown>);
    Object.values(value).forEach((item) => visit(item, fn, depth + 1));
  }
}

export function receiptGiftCard(value: unknown): { id?: string; lastCharacters: string } {
  const ids = new Set<string>();
  let lastCharacters = "";
  visit(value, (node) => {
    if (typeof node === "string") return;
    for (const [key, item] of Object.entries(node)) {
      if (/^gift_?card_?id$/i.test(key)) { const id = normalizeGiftCardId(item); if (id) ids.add(id); }
      if (/^gift_?card_?last_?characters$/i.test(key) && /^[a-z0-9]{4}$/i.test(String(item))) lastCharacters = String(item).toUpperCase();
    }
  });
  // Conflicting identifiers must not silently link two people.
  return { id: ids.size === 1 ? [...ids][0] : undefined, lastCharacters };
}

export function extractIssuances(events: Array<{ id: string; action: string; createdAt: string; additionalContent?: unknown }>): GiftIssuance[] {
  const found = new Map<string, GiftIssuance>();
  for (const event of events) {
    if (event.action !== "fulfillment_success") continue;
    visit(event.additionalContent, (node) => {
      if (typeof node !== "string") return;
      // Shopify's text component may contain a second layer of escaped HTML.
      // Decode only serialization escapes; never execute or render the markup.
      const html = node.replace(/\\u003c/gi, "<").replace(/\\u003e/gi, ">").replace(/\\u0026/gi, "&")
        .replace(/\\\//g, "/").replace(/\\"/g, '"');
      // An explicit Shopify admin link is the evidence, never a free-standing number or last four characters.
      for (const match of html.matchAll(/<a\b[^>]*href=["']\/admin\/gift_cards\/([1-9]\d*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        const giftCardId = normalizeGiftCardId(match[1])!;
        const text = match[2].replace(/<[^>]*>/g, "").trim();
        const lastCharacters = text.match(/([a-z0-9]{4})\s*$/i)?.[1].toUpperCase() ?? "";
        if (!found.has(giftCardId)) found.set(giftCardId, { giftCardId, lastCharacters, eventId: event.id, issuedAt: event.createdAt });
      }
    });
  }
  return [...found.values()];
}

export function extractGiftUses(transactions: Array<{
  id: string; gateway?: string | null; kind: string; status: string;
  processedAt?: string | null; receiptJson?: unknown;
  amountSet: { shopMoney: { amount: string; currencyCode: string } };
}>, fallbackTime: string) {
  const uses = new Map<string, GiftUse>();
  let unidentifiedTransactions = 0;
  for (const tx of transactions) {
    if (tx.status !== "SUCCESS" || !["SALE", "CAPTURE", "REFUND"].includes(tx.kind)) continue;
    const receipt = receiptGiftCard(tx.receiptJson);
    if (!receipt.id && !/^gift[ _-]?card$/i.test(tx.gateway ?? "")) continue;
    const amount = Number(tx.amountSet.shopMoney.amount);
    if (!receipt.id || !tx.id || !Number.isFinite(amount) || amount <= 0) { unidentifiedTransactions++; continue; }
    uses.set(tx.id, { giftCardId: receipt.id, lastCharacters: receipt.lastCharacters, transactionId: tx.id,
      amount, currency: tx.amountSet.shopMoney.currencyCode, processedAt: tx.processedAt ?? fallbackTime,
      kind: tx.kind as GiftUse["kind"] });
  }
  return { uses: [...uses.values()], unidentifiedTransactions };
}

export function buildGiftLedger(orders: GiftCardOrderEvidence[]): GiftLedger {
  const cards = new Map<string, GiftLedgerCard>();
  const cardFor = (order: GiftCardOrderEvidence, id: string, last: string) => {
    const key = `${order.tenantId}:${order.storeId}:${id}`;
    let card = cards.get(key);
    if (!card) { card = { key, storeId: order.storeId, giftCardId: id, lastCharacters: last, uses: [], purchaseConflict: false }; cards.set(key, card); }
    if (!card.lastCharacters && last) card.lastCharacters = last;
    return card;
  };
  const identity = (order: GiftCardOrderEvidence): GiftOrderIdentity => ({ orderId: order.orderId, orderNumber: order.orderNumber,
    customer: order.customer, email: order.email, customerId: order.customerId, createdAt: order.createdAt });
  for (const order of orders) {
    for (const issue of order.issued) {
      const card = cardFor(order, issue.giftCardId, issue.lastCharacters);
      if (card.purchase && card.purchase.orderId !== order.orderId) card.purchaseConflict = true;
      else card.purchase = { ...identity(order), eventId: issue.eventId, issuedAt: issue.issuedAt };
    }
    for (const use of order.uses) {
      const card = cardFor(order, use.giftCardId, use.lastCharacters);
      if (!card.uses.some((item) => item.transactionId === use.transactionId)) card.uses.push({ ...use, order: identity(order) });
    }
  }
  return { cards: [...cards.values()].sort((a, b) => b.uses.length - a.uses.length), orders };
}
