import { get, put } from "@vercel/blob";
import { decryptPrivateData, encryptPrivateData, persistOperationalState } from "@/lib/persistence.server";
import {
  exportCrediMatchChargebacks,
  exportCrediMatchOrderCandidates,
  restoreCrediMatchChargebacks,
  restoreCrediMatchOrderCandidates,
} from "@/lib/operational-store";
import type { CrediMatchChargeback, CrediMatchOrderCandidate } from "@/lib/types";

const blobPath = "private/credimatch-chargebacks.enc.json";
type CrediMatchPersistedState = {
  version: 2;
  chargebacks: CrediMatchChargeback[];
  orderCandidates: CrediMatchOrderCandidate[];
};
const configured = () => process.env.PERSISTENCE_BACKEND !== "supabase"
  && Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

async function read() {
  const result = await get(blobPath, {
    access: "private",
    useCache: false,
    headers: { "Accept-Encoding": "identity" },
  });
  if (!result || result.statusCode !== 200) {
    return { chargebacks: [] as CrediMatchChargeback[], orderCandidates: [] as CrediMatchOrderCandidate[], etag: undefined };
  }
  const encrypted = JSON.parse(await new Response(result.stream).text());
  const decrypted = decryptPrivateData<CrediMatchChargeback[] | CrediMatchPersistedState>(encrypted);
  const state = Array.isArray(decrypted)
    ? { chargebacks: decrypted, orderCandidates: [] as CrediMatchOrderCandidate[] }
    : { chargebacks: decrypted.chargebacks ?? [], orderCandidates: decrypted.orderCandidates ?? [] };
  return {
    ...state,
    etag: result.blob.etag,
  };
}

const keyFor = (item: CrediMatchChargeback) => `${item.tenantId}:${item.discrepancyId}`;
const orderKeyFor = (item: CrediMatchOrderCandidate) => `${item.tenantId}:${item.storeId}:${item.shopifyOrderId}`;

// Chargebacks live in an independent encrypted document so unrelated Shopify
// webhook snapshots can never remove them. Conditional writes preserve events
// received by another warm Vercel instance at the same time.
export async function persistCrediMatchChargebacks() {
  if (!configured()) {
    await persistOperationalState();
    return;
  }
  const incoming = exportCrediMatchChargebacks();
  const incomingOrders = exportCrediMatchOrderCandidates();
  for (let attempt = 0; attempt < 7; attempt++) {
    const current = await read();
    const merged = new Map(current.chargebacks.map((item) => [keyFor(item), item]));
    const mergedOrders = new Map(current.orderCandidates.map((item) => [orderKeyFor(item), item]));
    for (const item of incoming) {
      const previous = merged.get(keyFor(item));
      merged.set(keyFor(item), previous ? { ...previous, ...item } : item);
    }
    for (const item of incomingOrders) {
      const previous = mergedOrders.get(orderKeyFor(item));
      mergedOrders.set(orderKeyFor(item), previous ? { ...previous, ...item } : item);
    }
    try {
      const persisted: CrediMatchPersistedState = {
        version: 2,
        chargebacks: [...merged.values()],
        orderCandidates: [...mergedOrders.values()],
      };
      await put(blobPath, JSON.stringify(encryptPrivateData(persisted)), {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json",
        cacheControlMaxAge: 60,
        ...(current.etag ? { ifMatch: current.etag } : { allowOverwrite: false }),
      });
      restoreCrediMatchChargebacks([...merged.values()]);
      restoreCrediMatchOrderCandidates([...mergedOrders.values()]);
      return;
    } catch (error) {
      if (attempt === 6 || !/precondition|already exists|etag|condition.*match|conflicting operation/i.test(error instanceof Error ? error.message : "")) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(150 * 2 ** attempt, 2000) + Math.random() * 150));
    }
  }
}

export async function hydrateCrediMatchChargebacks() {
  if (!configured()) return;
  const current = await read();
  restoreCrediMatchChargebacks(current.chargebacks);
  restoreCrediMatchOrderCandidates(current.orderCandidates);
}
