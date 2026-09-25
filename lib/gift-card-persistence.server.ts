import { get, put } from "@vercel/blob";
import { decryptPrivateData, encryptPrivateData, persistOperationalState } from "@/lib/persistence.server";
import { getDashboardSnapshot, recordGiftCardOrderEvidence, refreshOrderEvidenceLinks } from "@/lib/operational-store";
import type { GiftCardOrderEvidence } from "@/lib/gift-card-evidence";

const configured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const pathFor = (tenantId: string, storeId: string) => `private/gift-ledger/${encodeURIComponent(tenantId)}/${encodeURIComponent(storeId)}.json`;

async function read(tenantId: string, storeId: string) {
  // Compression turns the HTTP ETag into W/"...". Request the identity
  // representation so Blob's conditional-write API receives the strong ETag.
  const result = await get(pathFor(tenantId, storeId), { access: "private", useCache: false, headers: { "Accept-Encoding": "identity" } });
  if (!result || result.statusCode !== 200) return { orders: [] as GiftCardOrderEvidence[], etag: undefined };
  const encrypted = JSON.parse(await new Response(result.stream).text());
  return { orders: decryptPrivateData<GiftCardOrderEvidence[]>(encrypted), etag: result.blob.etag };
}

// Independent encrypted ledger + conditional writes: a scan cannot overwrite live orders,
// merchant decisions, or another instance's newly discovered gift-card evidence.
export async function persistGiftEvidence(tenantId: string, storeId: string, incoming: GiftCardOrderEvidence[]) {
  if (!incoming.length) return;
  if (!configured()) { await persistOperationalState(); return; }
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await read(tenantId, storeId);
    const merged = new Map(current.orders.map((order) => [order.orderId, order]));
    for (const order of incoming) {
      if (order.tenantId !== tenantId || order.storeId !== storeId) throw new Error("GIFT_LEDGER_SCOPE_MISMATCH");
      const previous = merged.get(order.orderId);
      const newest = previous && previous.checkedAt > order.checkedAt ? previous : order;
      merged.set(order.orderId, { ...newest,
        purchaseAmounts: newest.purchaseAmounts ?? previous?.purchaseAmounts ?? order.purchaseAmounts,
        issued: [...new Map([...(previous?.issued ?? []), ...order.issued].map((item) => [item.giftCardId, item])).values()],
        uses: [...new Map([...(previous?.uses ?? []), ...order.uses].map((item) => [item.transactionId, item])).values()],
      });
    }
    try {
      await put(pathFor(tenantId, storeId), JSON.stringify(encryptPrivateData([...merged.values()])), {
        access: "private", addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60,
        ...(current.etag ? { ifMatch: current.etag } : { allowOverwrite: false }),
      });
      return;
    } catch (error) {
      // Retry only conflicts, not permission/configuration errors.
      if (attempt === 4 || !/precondition|already exists|etag|condition.*match/i.test(error instanceof Error ? error.message : "")) throw error;
    }
  }
}

export async function hydrateGiftEvidence(tenantId: string) {
  if (!configured()) return;
  const stores = getDashboardSnapshot(tenantId).stores;
  await Promise.all(stores.map(async (store) => {
    const { orders } = await read(tenantId, store.id);
    for (const order of orders) if (order.tenantId === tenantId && order.storeId === store.id) recordGiftCardOrderEvidence(order, false);
    refreshOrderEvidenceLinks(store.id);
  }));
}
