import { createHash } from "node:crypto";
import type { PersistedOperationalState } from "@/lib/operational-store";

// Fixed, bounded layout: only the largest collection is bucketed. Other
// collections retain their original ordering and are independently encrypted.
export const PARTITION_PREFIX = "op2-";
export const PARTITION_MARKER = "op2-ready";
const bucketCount = 128;
export function partitionState(state: PersistedOperationalState): Map<string, unknown> {
  const parts = new Map<string, unknown>();
  const complete = {employeeSettingsByTenant: [],giftCards: [],giftCardOrders: [],chargebacks: [],...state};
  for (const [field, value] of Object.entries(complete)) {
    if (field !== "orders") parts.set(`op2-field-${field}`, value);
  }
  const buckets: PersistedOperationalState["orders"][] = Array.from({length: bucketCount}, () => []);
  for (const order of state.orders) {
    const identity = JSON.stringify([order.tenantId, order.storeId, order.shopifyOrderId]);
    const bucket = createHash("sha256").update(identity).digest().readUInt16BE(0) % bucketCount;
    buckets[bucket].push(order);
  }
  for (let i = 0; i < bucketCount; i++) {
    buckets[i].sort((a, b) => JSON.stringify([a.tenantId,a.storeId,a.shopifyOrderId]).localeCompare(JSON.stringify([b.tenantId,b.storeId,b.shopifyOrderId])));
    parts.set(`op2-orders-${String(i).padStart(3, "0")}`, buckets[i]);
  }
  return parts;
}

export function assembleState(parts: Map<string, unknown>): PersistedOperationalState {
  const result: Record<string, unknown> = {};
  for (const [id, value] of parts) {
    if (id.startsWith("op2-field-")) result[id.slice("op2-field-".length)] = value;
  }
  const orders: PersistedOperationalState["orders"] = [];
  for (let i = 0; i < bucketCount; i++) {
    const bucket = parts.get(`op2-orders-${String(i).padStart(3, "0")}`);
    if (!Array.isArray(bucket)) throw new Error("PERSISTENCE_PARTITION_MISSING");
    orders.push(...bucket);
  }
  if (result.version !== 1 || !Array.isArray(result.stores) || !Array.isArray(result.cases)) {
    throw new Error("PERSISTENCE_PARTITION_INVALID");
  }
  // Order ingestion appends records; screens perform their own date sorting.
  // Do not depend on bucket order for historical evaluation.
  orders.sort((a,b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.shopifyOrderId.localeCompare(b.shopifyOrderId));
  return {...result, orders} as PersistedOperationalState;
}

export const partitionPath = (id: string) => id.startsWith("op2-orders-") ? ".orders" : `.${id.slice("op2-field-".length)}`;

// Migration comparison deliberately ignores physical order of the order array,
// but includes every field of every record and every other collection.
export function stateFingerprint(state: PersistedOperationalState): string {
  return createHash("sha256").update(JSON.stringify([...partitionState(state)].sort(([a],[b]) => a.localeCompare(b)))).digest("hex");
}
