import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifySessionToken } from "@/lib/auth";

const publicPath = (pathname: string) =>
  pathname === "/login" ||
  pathname === "/api/auth/login" ||
  pathname.startsWith("/api/shopify/webhooks/");

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (publicPath(pathname)) return NextResponse.next();

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
