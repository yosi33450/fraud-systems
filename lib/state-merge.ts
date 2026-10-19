// Apply only this instance's changes to the latest durable snapshot.
// Conflicting edits fail closed instead of silently choosing a winner.
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
function key(v: unknown): string | undefined {
  if (typeof v === "string") return `s:${v}`;
  if (Array.isArray(v) && typeof v[0] === "string") return `t:${v[0]}`;
  if (object(v) && typeof v.id === "string") return `i:${v.id}`;
  if (object(v) && typeof v.shopifyOrderId === "string") return `o:${v.tenantId}:${v.storeId}:${v.shopifyOrderId}`;
  if (object(v) && typeof v.giftCardId === "string") return `g:${v.tenantId}:${v.storeId}:${v.giftCardId}`;
  if (object(v) && typeof v.orderId === "string") return `go:${v.tenantId}:${v.storeId}:${v.orderId}`;
  if (object(v) && typeof v.transactionId === "string") return `tx:${v.transactionId}`;
  return undefined;
}
export function mergeStateChanges<T>(base: T, local: T, remote: T, path = ""): T {
  if (same(base, local)) return structuredClone(remote);
  if (same(base, remote) || same(local, remote)) return structuredClone(local);
  if (object(base) && object(local) && object(remote)) {
    const result: Record<string, unknown> = {};
    for (const field of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const value = mergeStateChanges(base[field], local[field], remote[field], `${path}.${field}`);
      if (value !== undefined) result[field] = value;
    }
    return result as T;
  }
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    if (base.length === 2 && local.length === 2 && remote.length === 2 && typeof base[0] === "string" && base[0] === local[0] && base[0] === remote[0] && typeof base[1] !== "string") {
      return [base[0], mergeStateChanges(base[1], local[1], remote[1], path)] as T;
    }
    const arrays = [base, local, remote];
    if (arrays.every(items => items.every(v => key(v) !== undefined) && new Set(items.map(key)).size === items.length)) {
      const [b, l, r] = arrays.map(items => new Map(items.map(v => [key(v)!, v])));
      const result = [];
      for (const id of new Set([...r.keys(), ...l.keys(), ...b.keys()])) {
        const value = mergeStateChanges(b.get(id), l.get(id), r.get(id), `${path}.*`);
        if (value !== undefined) result.push(value);
      }
      return result as T;
    }
  }
  // These are refreshed observations, not user configuration. A newer durable
  // observation wins over an older replay. Independent additions still merge.
  if (/^\.(stores|orders|giftCards|giftCardOrders|chargebacks)\./.test(path)
      || /^\.rulesByTenant\..*\.matches$/.test(path)) return structuredClone(remote);
  throw new Error(`PERSISTENCE_CONCURRENT_EDIT:${path}`);
}
