import { NextResponse } from "next/server";
import { verifyShopifyIdToken } from "@/lib/shopify-embedded-auth";

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const identity = authorization.startsWith("Bearer ")
    ? verifyShopifyIdToken(authorization.slice(7), process.env.SHOPIFY_EMBEDDED_CLIENT_SECRET) : null;
  return NextResponse.json(identity ? { ok: true } : { error: "UNAUTHORIZED" }, {
    status: identity ? 200 : 401,
    headers: { "Cache-Control": "no-store", ...(!identity ? { "X-Shopify-Retry-Invalid-Session-Request": "1" } : {}) },
  });
}
