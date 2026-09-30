import { get, put } from "@vercel/blob";
import { decryptPrivateData, encryptPrivateData, persistOperationalState } from "@/lib/persistence.server";
import { exportCrediMatchChargebacks, restoreCrediMatchChargebacks } from "@/lib/operational-store";
import type { CrediMatchChargeback } from "@/lib/types";

const blobPath = "private/credimatch-chargebacks.enc.json";
const configured = () => process.env.PERSISTENCE_BACKEND !== "supabase"
  && Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

async function read() {
  const result = await get(blobPath, {
    access: "private",
    useCache: false,
    headers: { "Accept-Encoding": "identity" },
  });
  if (!result || result.statusCode !== 200) {
    return { chargebacks: [] as CrediMatchChargeback[], etag: undefined };
  }
  const encrypted = JSON.parse(await new Response(result.stream).text());
  return {
    chargebacks: decryptPrivateData<CrediMatchChargeback[]>(encrypted),
    etag: result.blob.etag,
  };
}

const keyFor = (item: CrediMatchChargeback) => `${item.tenantId}:${item.discrepancyId}`;

// Chargebacks live in an independent encrypted document so unrelated Shopify
// webhook snapshots can never remove them. Conditional writes preserve events
// received by another warm Vercel instance at the same time.
export async function persistCrediMatchChargebacks() {
  if (!configured()) {
    await persistOperationalState();
    return;
  }
  const incoming = exportCrediMatchChargebacks();
  for (let attempt = 0; attempt < 7; attempt++) {
    const current = await read();
    const merged = new Map(current.chargebacks.map((item) => [keyFor(item), item]));
    for (const item of incoming) {
      const previous = merged.get(keyFor(item));
      merged.set(keyFor(item), previous ? { ...previous, ...item } : item);
    }
    try {
      await put(blobPath, JSON.stringify(encryptPrivateData([...merged.values()])), {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json",
        cacheControlMaxAge: 60,
        ...(current.etag ? { ifMatch: current.etag } : { allowOverwrite: false }),
      });
      restoreCrediMatchChargebacks([...merged.values()]);
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
}
