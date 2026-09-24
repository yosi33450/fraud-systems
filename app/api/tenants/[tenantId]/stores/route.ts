import { NextResponse } from "next/server";
import { connectShopifyStore } from "@/lib/operational-store";
import { requestOrganizationAccessToken, testShopifyConnection } from "@/lib/shopify-admin.server";
import { syncOrdersLast30Days } from "@/lib/shopify-sync.server";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  await hydrateOperationalState();
  if (process.env.ALLOW_MANUAL_SHOPIFY_CONNECTIONS !== "true") {
    return NextResponse.json({ error: "MANUAL_CONNECTIONS_DISABLED" }, { status: 403 });
  }
  const { tenantId } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "INVALID_CONNECTION" }, { status: 400 });
  const { shopDomain, clientId, clientSecret } = body as Record<string, unknown>;
  if (![shopDomain, clientId, clientSecret].every((value) => typeof value === "string" && value.trim())) {
    return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 400 });
  }
  try {
    const token = await requestOrganizationAccessToken({
      shopDomain: String(shopDomain), clientId: String(clientId), clientSecret: String(clientSecret),
    });
    const data = await testShopifyConnection(token.shopDomain, token.accessToken);
    const store = connectShopifyStore({
      tenantId,
      name: data.shop.name,
      domain: data.shop.myshopifyDomain,
      accessToken: token.accessToken,
      expiresIn: token.expiresIn,
    });
    const sync = await syncOrdersLast30Days({
      tenantId,
      storeId: store.id,
      shopDomain: store.domain,
      accessToken: token.accessToken,
    });
    await persistOperationalState();
    return NextResponse.json({ connected: true, store: sync.store, sync });
  } catch (error) {
    await persistOperationalState().catch(() => undefined);
    const message = error instanceof Error ? error.message : "SHOPIFY_CONNECTION_FAILED";
    console.error("[shopify-connection] failed", {
      tenantId,
      shopDomain: typeof shopDomain === "string" ? shopDomain.trim().toLowerCase() : "invalid",
      code: message,
    });
    return NextResponse.json({ connected: false, error: message }, { status: 502 });
  }
}
