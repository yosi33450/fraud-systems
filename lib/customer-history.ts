export interface CustomerHistoryOrder {
  tenantId: string; storeId: string; shopifyOrderId: string; orderNumber?: string;
  customerId?: string; email?: string; phone?: string; createdAt: string; amount: number; currency?: string;
}
const emailKey = (value?: string) => {
  const email = value?.trim().toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/^(general|unknown|no-?reply|test)@/.test(email) ? email : "";
};
const phoneKey = (value?: string) => {
  const digits = (value ?? "").replace(/\D/g, "").replace(/^972/, "0");
  return digits.length >= 9 ? digits : "";
};
export function customerHistory(source: CustomerHistoryOrder, orders: CustomerHistoryOrder[]) {
  const email = emailKey(source.email), phone = phoneKey(source.phone);
  const unique = new Map<string, CustomerHistoryOrder>();
  for (const order of orders) {
    if (order.tenantId !== source.tenantId || order.storeId !== source.storeId) continue;
    const same = order.shopifyOrderId === source.shopifyOrderId
      || (email && email === emailKey(order.email))
      || (phone && phone === phoneKey(order.phone))
      || (source.customerId && order.customerId === source.customerId);
    if (same) unique.set(order.shopifyOrderId, order);
  }
  return [...unique.values()].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
}
