import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifySessionToken } from "@/lib/auth";
import { EMBEDDED_SHOP, embeddedPathAllowed, verifyShopifyIdToken } from "@/lib/shopify-embedded-auth";

const publicPath = (pathname: string) =>
  pathname === "/login" ||
  pathname === "/api/auth/login" ||
  pathname === "/api/credimatch/webhook" ||
  pathname === "/api/cron/credimatch-reconcile" ||
  pathname.startsWith("/api/shopify/webhooks/");

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/shopify") {
    const response = NextResponse.next();
    response.headers.set("Content-Security-Policy", `frame-ancestors https://admin.shopify.com https://${EMBEDDED_SHOP}`);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  if (publicPath(pathname)) return NextResponse.next();

  const authorization = request.headers.get("authorization");
  if (authorization || pathname === "/api/auth/shopify") {
    const identity = authorization?.startsWith("Bearer ")
      ? verifyShopifyIdToken(authorization.slice(7), process.env.SHOPIFY_EMBEDDED_CLIENT_SECRET) : null;
    if (!identity) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401,
      headers: { "Cache-Control": "no-store", "X-Shopify-Retry-Invalid-Session-Request": "1" } });
    if (!embeddedPathAllowed(pathname, request.method)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  const authenticated = await verifySessionToken(
    request.cookies.get(AUTH_COOKIE)?.value,
    process.env.AUTH_SECRET,
  );
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
