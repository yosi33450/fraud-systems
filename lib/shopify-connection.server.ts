import { getStoreConnectionForRefresh, updateStoreAccessToken } from "@/lib/operational-store";
import { persistOperationalState } from "@/lib/persistence.server";
import { requestOrganizationAccessToken } from "@/lib/shopify-admin.server";

const refreshes = new Map<string, Promise<void>>();
const refreshBeforeExpiryMs = 5 * 60_000;

export async function getFreshStoreConnection(tenantId: string, storeId: string) {
  const connection = getStoreConnectionForRefresh(tenantId, storeId);
  if (Date.parse(connection.expiresAt) > Date.now() + refreshBeforeExpiryMs) return connection;

  const key = `${tenantId}:${storeId}`;
  let refresh = refreshes.get(key);
  if (!refresh) {
    refresh = (async () => {
      const latest = getStoreConnectionForRefresh(tenantId, storeId);
      if (Date.parse(latest.expiresAt) > Date.now() + refreshBeforeExpiryMs) return;
      const clientId = latest.clientId || process.env.SHOPIFY_CLIENT_ID;
      const clientSecret = latest.webhookSecret;
      if (!clientId || !clientSecret) throw new Error("SHOPIFY_RECONNECT_REQUIRED");
      const token = await requestOrganizationAccessToken({ shopDomain: latest.store.domain, clientId, clientSecret });
      updateStoreAccessToken(tenantId, storeId, token.accessToken, token.expiresIn);
      await persistOperationalState();
    })().finally(() => refreshes.delete(key));
    refreshes.set(key, refresh);
  }
  await refresh;
  return getStoreConnectionForRefresh(tenantId, storeId);
}
