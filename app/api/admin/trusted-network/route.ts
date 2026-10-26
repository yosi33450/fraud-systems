import {NextRequest, NextResponse} from "next/server";
import {isIP} from "node:net";
import {AUTH_COOKIE, verifySessionToken} from "@/lib/auth";
import {hydrateOperationalState, persistOperationalState} from "@/lib/persistence.server";
import {trustStoreNetworkIp} from "@/lib/operational-store";
export async function POST(request:NextRequest) {
  if (!await verifySessionToken(request.cookies.get(AUTH_COOKIE)?.value,process.env.AUTH_SECRET)) return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  const body=await request.json().catch(()=>null);
  if (!body || typeof body.tenantId!=="string" || typeof body.storeId!=="string" || typeof body.ip!=="string" || !isIP(body.ip.trim())) return NextResponse.json({error:"INVALID_REQUEST"},{status:400});
  await hydrateOperationalState({refresh:true});
  const result=trustStoreNetworkIp(body.tenantId,body.storeId,body.ip);
  await persistOperationalState();
  return NextResponse.json({saved:true,...result});
}
