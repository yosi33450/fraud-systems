import type { GiftLedger } from "./gift-card-evidence";
import type { FraudCase } from "./types";

export type MoneyTotal = { currency: string; amount: number };
export function summarizeGiftCluster(cases: FraudCase[], ledger?: GiftLedger) {
  const key = (store: string, order: string) => `${store}:${order}`;
  const orders = new Map((ledger?.orders ?? []).map((order) => [key(order.storeId, order.orderId), order]));
  const purchases: FraudCase[] = [], redemptions: FraudCase[] = [], other: FraudCase[] = [];
  const purchased = new Map<string, number>(), redeemed = new Map<string, number>(), refunded = new Map<string, number>();
  const linkedRedeemed = new Map<string, number>();
  const purchasedOrders = new Set<string>(), seenOrders = new Set<string>(), seenTransactions = new Set<string>();
  let missingPurchaseAmounts = 0;
  const add = (map: Map<string, number>, currency: string, amount: number) => {
    if (/^[A-Z]{3}$/.test(currency) && Number.isFinite(amount)) map.set(currency, (map.get(currency) ?? 0) + Math.round(amount * 100));
  };
  for (const item of cases) {
    const id = key(item.storeId, item.context?.shopifyOrderId ?? item.id);
    if (seenOrders.has(id)) continue;
    seenOrders.add(id);
    const order = orders.get(id);
    const buys = order ? order.giftCardUnits > 0 : Boolean(item.context?.giftCards?.issued.length || item.signals?.giftCardValue || item.items.some((line) => /gift\s*card|גיפט\s*קארד|כרטיס\s*מתנה/i.test(line.name)));
    const uses = order?.uses.filter((use) => use.kind !== "REFUND") ?? item.context?.giftCards?.redeemed ?? [];
    if (buys) {
      purchases.push(item); purchasedOrders.add(id);
      if (order?.purchaseAmounts) for (const money of order.purchaseAmounts) add(purchased, money.currency, money.amount);
      else missingPurchaseAmounts++;
    }
    if (uses.length) redemptions.push(item);
    if (!buys && !uses.length) other.push(item);
    for (const use of order?.uses ?? []) {
      const transaction = key(item.storeId, use.transactionId);
      if (seenTransactions.has(transaction)) continue;
      seenTransactions.add(transaction);
      add(use.kind === "REFUND" ? refunded : redeemed, use.currency, use.amount);
    }
  }
  // Only exact card IDs whose purchase is in this group count as "used from these purchases".
  // All observed uses of those cards count, including orders without an alert.
  const seenLinked = new Set<string>();
  for (const card of ledger?.cards ?? []) {
    if (!card.purchase || card.purchaseConflict || !purchasedOrders.has(key(card.storeId, card.purchase.orderId))) continue;
    for (const use of card.uses) {
      const id = key(card.storeId, use.transactionId);
      if (use.kind === "REFUND" || seenLinked.has(id)) continue;
      seenLinked.add(id); add(linkedRedeemed, use.currency, use.amount);
    }
  }
  const totals = (map: Map<string, number>): MoneyTotal[] => [...map].map(([currency, cents]) => ({ currency, amount: cents / 100 }));
  return { purchases, redemptions, other, purchased: totals(purchased), redeemed: totals(redeemed), refunded: totals(refunded), linkedRedeemed: totals(linkedRedeemed), missingPurchaseAmounts };
}
