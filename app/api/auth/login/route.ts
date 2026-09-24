import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, createSessionToken, SESSION_SECONDS } from "@/lib/auth";

const equal = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export async function POST(request: NextRequest) {
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  const authSecret = process.env.AUTH_SECRET;
  if (!expectedPassword || !authSecret) {
    return NextResponse.json({ error: "AUTH_NOT_CONFIGURED" }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { password?: string } | null;
  if (!body?.password || !equal(body.password, expectedPassword)) {
    return NextResponse.json({ error: "INVALID_PASSWORD" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, await createSessionToken(authSecret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_SECONDS,
    path: "/",
  });
  return response;
}
