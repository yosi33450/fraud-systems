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
    const headers = new Headers(request.headers);
    headers.set("x-shopshield-embedded", "1");
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("Content-Security-Policy", `frame-ancestors https://admin.shopify.com https://${EMBEDDED_SHOP}`);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  if (publicPath(pathname)) return NextResponse.next();

  const authorization = request.headers.get("authorization");
  if (authorization || pathname === "/api/auth/shopify") {
    const identity = authorization?.startsWith("Bearer ")
      ? verifyShopifyIdToken(authorization.slice(7), process.env.SHOPIFY_EMBEDDED_CLIENT_SECRET) : null;
    if (!identity) {
      // Log only validation booleans/timing, never tokens or personal data.
      try {
        const claims = JSON.parse(Buffer.from((authorization ?? "").split(".")[1] ?? "", "base64url").toString());
        console.warn("SHOPIFY_EMBEDDED_AUTH_REJECTED", {
          path: pathname, hasSecret: !!process.env.SHOPIFY_EMBEDDED_CLIENT_SECRET,
          expiresIn: claims.exp - Date.now() / 1000, notBeforeIn: claims.nbf - Date.now() / 1000,
          issuedIn: claims.iat - Date.now() / 1000, lifetime: claims.exp - claims.iat,
          audience: claims.aud === "594764d5141fa6d79d1dc989d3064e80",
          issuer: claims.iss === `https://${EMBEDDED_SHOP}/admin`,
          destination: claims.dest === `https://${EMBEDDED_SHOP}`,
          userType: typeof claims.sub,
        });
      } catch { console.warn("SHOPIFY_EMBEDDED_AUTH_REJECTED", { path: pathname, missingOrMalformed: true }); }
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401,
      headers: { "Cache-Control": "no-store", "X-Shopify-Retry-Invalid-Session-Request": "1" } });
    }
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
