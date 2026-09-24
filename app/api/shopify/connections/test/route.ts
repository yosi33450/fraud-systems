import { NextResponse } from "next/server";
import { testShopifyConnection } from "@/lib/shopify-admin.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (process.env.ALLOW_MANUAL_SHOPIFY_CONNECTIONS !== "true") {
    return NextResponse.json({ error: "MANUAL_CONNECTIONS_DISABLED" }, { status: 403 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "INVALID_CONNECTION" }, { status: 400 });
  const { shopDomain, accessToken } = body as Record<string, unknown>;
  if (typeof shopDomain !== "string" || typeof accessToken !== "string" || !accessToken) {
    return NextResponse.json({ error: "INVALID_CONNECTION" }, { status: 400 });
  }
  try {
    const data = await testShopifyConnection(shopDomain, accessToken);
    return NextResponse.json({ connected: true, shop: data.shop });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SHOPIFY_CONNECTION_FAILED";
    return NextResponse.json({ connected: false, error: message }, { status: 502 });
  }
}
