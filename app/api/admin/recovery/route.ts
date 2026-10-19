import {NextRequest, NextResponse} from "next/server";
import {AUTH_COOKIE, verifySessionToken} from "@/lib/auth";
import {inspectRecoveryState} from "@/lib/persistence.server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  // Require the owner dashboard session, not an embedded employee token.
  if (!await verifySessionToken(request.cookies.get(AUTH_COOKIE)?.value, process.env.AUTH_SECRET)) {
    return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  }
  return NextResponse.json(await inspectRecoveryState(),{headers:{"Cache-Control":"no-store"}});
}
