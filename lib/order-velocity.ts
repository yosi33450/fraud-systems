import { isSharedServiceEmail } from "@/lib/customer-identity";
import type { RiskCondition } from "@/lib/types";

export type VelocityOrder = {
  tenantId: string; storeId: string; shopifyOrderId: string;
  createdAt: string; email: string; ip: string; phone: string;
  amount: number; giftCardValue: number;
};
export const velocityDefaults: Record<string, number> = {
  orders_by_email: 60, orders_by_ip: 120, gift_card_orders_by_ip: 120,
  emails_by_ip: 120, identities_by_phone: 1440,
};
export const velocityKey = (field: string, minutes: number) => `${field}:${minutes}`;
const emailKey = (value: string) => {
  const email = value.trim().toLowerCase();
  return email.includes("@") && !isSharedServiceEmail(email) ? email : "";
};
const phoneKey = (value: string) => value.replace(/\D/g, "");
const orderKey = (order: VelocityOrder) => `${order.tenantId}:${order.storeId}:${order.shopifyOrderId}`;

/** Build once for batch reconciliation; binary-search bounded history per store. */
export function createVelocityLookup(history: VelocityOrder[], conditions: RiskCondition[]) {
  const minutes = Math.max(...Object.values(velocityDefaults), ...conditions
    .filter((c) => c.field in velocityDefaults && Number.isFinite(c.windowMinutes))
    .map((c) => c.windowMinutes ?? 0));
  const stores = new Map<string, Array<{ order: VelocityOrder; time: number }>>();
  for (const order of history) {
    const time = Date.parse(order.createdAt);
    if (!Number.isFinite(time)) continue;
    const key = JSON.stringify([order.tenantId, order.storeId]);
    const rows = stores.get(key) ?? [];
    rows.push({ order, time });
    stores.set(key, rows);
  }
  for (const rows of stores.values()) rows.sort((a, b) => a.time - b.time);
  return (current: VelocityOrder) => {
    const rows = stores.get(JSON.stringify([current.tenantId, current.storeId])) ?? [];
    const end = Date.parse(current.createdAt);
    const upperBound = (time: number) => {
      let low = 0, high = rows.length;
      while (low < high) { const mid = (low + high) >>> 1; if (rows[mid].time <= time) low = mid + 1; else high = mid; }
      return low;
    };
    return computeVelocitySignals(current, rows.slice(upperBound(end - minutes * 60_000), upperBound(end)).map((row) => row.order), conditions);
  };
}

/** Event-time windows are (end - duration, end], never based on ingestion time.
 * Deduplicate updates, count the current purchase once, and isolate each store.
 * No old alert counts or inferred timestamps are accepted as order history.
 */
export function computeVelocitySignals(current: VelocityOrder, history: VelocityOrder[], conditions: RiskCondition[]) {
  const end = Date.parse(current.createdAt);
  const canCount = Number.isFinite(end) && (current.amount > 0 || current.giftCardValue > 0);
  const unique = new Map<string, VelocityOrder>();
  for (const order of history) {
    if (order.tenantId === current.tenantId && order.storeId === current.storeId && order.shopifyOrderId) unique.set(orderKey(order), order);
  }
  if (current.shopifyOrderId) unique.set(orderKey(current), current);
  const eligible = canCount ? [...unique.values()].filter((order) => {
    const time = Date.parse(order.createdAt);
    return (order.amount > 0 || order.giftCardValue > 0) && Number.isFinite(time) && time <= end;
  }) : [];
  const requested = new Map(Object.entries(velocityDefaults).map(([field, minutes]) => [velocityKey(field, minutes), { field, minutes }]));
  for (const condition of conditions) {
    if (!(condition.field in velocityDefaults)) continue;
    const minutes = condition.windowMinutes ?? velocityDefaults[condition.field];
    requested.set(velocityKey(condition.field, minutes), { field: condition.field, minutes });
  }
  const conditionValues: Record<string, number> = {};
  const email = emailKey(current.email);
  const phone = phoneKey(current.phone);
  const ip = current.ip.trim();
  for (const [key, { field, minutes }] of requested) {
    const rows = Number.isFinite(minutes) && minutes > 0 ? eligible.filter((order) => Date.parse(order.createdAt) > end - minutes * 60_000) : [];
    const ipRows = ip ? rows.filter((order) => order.ip.trim() === ip) : [];
    switch (field) {
      case "orders_by_email": conditionValues[key] = email ? rows.filter((order) => emailKey(order.email) === email).length : 0; break;
      case "orders_by_ip": conditionValues[key] = ipRows.length; break;
      case "gift_card_orders_by_ip": conditionValues[key] = ipRows.filter((order) => order.giftCardValue > 0).length; break;
      case "emails_by_ip": conditionValues[key] = new Set(ipRows.map((order) => emailKey(order.email)).filter(Boolean)).size; break;
      case "identities_by_phone": conditionValues[key] = phone ? new Set(rows.filter((order) => phoneKey(order.phone) === phone).map((order) => emailKey(order.email)).filter(Boolean)).size : 0; break;
    }
  }
  return {
    conditionValues,
    ordersByEmailLastHour: conditionValues[velocityKey("orders_by_email", 60)],
    ordersByIpLastTwoHours: conditionValues[velocityKey("orders_by_ip", 120)],
    giftCardOrdersByIpLastTwoHours: conditionValues[velocityKey("gift_card_orders_by_ip", 120)],
    emailsByIpLastTwoHours: conditionValues[velocityKey("emails_by_ip", 120)],
    identitiesByPhoneLastDay: conditionValues[velocityKey("identities_by_phone", 1440)],
  };
}
