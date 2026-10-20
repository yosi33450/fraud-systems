import {NextRequest, NextResponse} from "next/server";
import {AUTH_COOKIE, verifySessionToken} from "@/lib/auth";
import {inspectRecoveryState, hydrateOperationalState, persistOperationalState, initializePartitionedState} from "@/lib/persistence.server";
import {getFreshStoreConnection} from "@/lib/shopify-connection.server";
import {replayCustomerOrders} from "@/lib/shopify-sync.server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  // Require the owner dashboard session, not an embedded employee token.
  if (!await verifySessionToken(request.cookies.get(AUTH_COOKIE)?.value, process.env.AUTH_SECRET)) {
    return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  }
  return NextResponse.json(await inspectRecoveryState(),{headers:{"Cache-Control":"no-store"}});
}
export async function POST(request: NextRequest) {
  if (!await verifySessionToken(request.cookies.get(AUTH_COOKIE)?.value, process.env.AUTH_SECRET)) return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  const body = await request.json();
  if (body.action === "initialize-partitions") return NextResponse.json(await initializePartitionedState(),{headers:{"Cache-Control":"no-store"}});
  if (body.action !== "replay-customer" || !["558020","558026","558034"].includes(body.orderNumber)) return NextResponse.json({error:"INVALID_RECOVERY_REQUEST"},{status:400});
  await hydrateOperationalState({refresh:true,force:true});
  const storeId="01424c82-a2dc-4b09-b394-0a119def7848";
  const connection = await getFreshStoreConnection("tenant-primary",storeId);
  const result = await replayCustomerOrders({storeId,shopDomain:connection.store.domain,accessToken:connection.accessToken,orderNumber:body.orderNumber});
  await persistOperationalState();
  return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
}
