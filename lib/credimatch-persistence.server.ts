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
const supabaseStateId = "credimatch";
type CrediMatchPersistedState = {
  version: 2;
  chargebacks: CrediMatchChargeback[];
  orderCandidates: CrediMatchOrderCandidate[];
};
type EncryptedState = ReturnType<typeof encryptPrivateData>;
type PersistedRow = EncryptedState & { updated_at: string };

const supabaseConfiguration = () => {
  if (process.env.PERSISTENCE_BACKEND !== "supabase") return null;
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
};
const useBlob = () => !supabaseConfiguration()
  && process.env.PERSISTENCE_BACKEND !== "local"
  && Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const configured = () => Boolean(supabaseConfiguration()) || useBlob();
const emptyState = () => ({
  chargebacks: [] as CrediMatchChargeback[],
  orderCandidates: [] as CrediMatchOrderCandidate[],
  revision: undefined as string | undefined,
});

const decode = (encrypted: EncryptedState) => {
  const decrypted = decryptPrivateData<CrediMatchChargeback[] | CrediMatchPersistedState>(encrypted);
  return Array.isArray(decrypted)
    ? { chargebacks: decrypted, orderCandidates: [] as CrediMatchOrderCandidate[] }
    : { chargebacks: decrypted.chargebacks ?? [], orderCandidates: decrypted.orderCandidates ?? [] };
};

async function read() {
  const supabase = supabaseConfiguration();
  if (supabase) {
    const response = await fetch(`${supabase.url}/rest/v1/shield_ledger_state?id=eq.${supabaseStateId}&select=ciphertext,iv,auth_tag,updated_at&limit=1`, {
      headers: { apikey: supabase.key, Authorization: `Bearer ${supabase.key}` },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`CREDIMATCH_PERSISTENCE_READ_FAILED_${response.status}`);
    const row = (await response.json() as PersistedRow[])[0];
    return row ? { ...decode(row), revision: row.updated_at } : emptyState();
  }
  const result = await get(blobPath, {
    access: "private",
    useCache: false,
    headers: { "Accept-Encoding": "identity" },
  });
  if (!result || result.statusCode !== 200) {
    return emptyState();
  }
  return {
    ...decode(JSON.parse(await new Response(result.stream).text()) as EncryptedState),
    revision: result.blob.etag,
  };
}

async function write(payload: EncryptedState, revision?: string) {
  const supabase = supabaseConfiguration();
  if (supabase) {
    const updatedAt = new Date().toISOString();
    const headers = {
      apikey: supabase.key,
      Authorization: `Bearer ${supabase.key}`,
      "Content-Type": "application/json",
      Prefer: revision ? "return=representation" : "resolution=ignore-duplicates,return=representation",
    };
    const response = await fetch(revision
      ? `${supabase.url}/rest/v1/shield_ledger_state?id=eq.${supabaseStateId}&updated_at=eq.${encodeURIComponent(revision)}`
      : `${supabase.url}/rest/v1/shield_ledger_state`, {
      method: revision ? "PATCH" : "POST",
      headers,
      body: JSON.stringify(revision ? { ...payload, updated_at: updatedAt } : { id: supabaseStateId, ...payload, updated_at: updatedAt }),
    });
    if (!response.ok) throw new Error(`CREDIMATCH_PERSISTENCE_WRITE_FAILED_${response.status}`);
    const rows = await response.json() as PersistedRow[];
    if (rows.length !== 1) throw new Error("CREDIMATCH_PERSISTENCE_PRECONDITION_FAILED");
    return;
  }
  await put(blobPath, JSON.stringify(payload), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60,
    ...(revision ? { ifMatch: revision } : { allowOverwrite: false }),
  });
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
      await write(encryptPrivateData(persisted), current.revision);
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
