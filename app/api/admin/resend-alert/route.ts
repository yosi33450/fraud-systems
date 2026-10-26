import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { AUTH_COOKIE, verifySessionToken } from "@/lib/auth";
import { buildAlertEmail } from "@/lib/alert-email";
import { getDashboardSnapshot, getNotificationSettings, recordNotificationDelivery } from "@/lib/operational-store";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";

export async function POST(request: NextRequest) {
  if (!await verifySessionToken(request.cookies.get(AUTH_COOKIE)?.value, process.env.AUTH_SECRET)) return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  const body = await request.json().catch(() => null);
  if (!body || typeof body.tenantId !== "string" || typeof body.deliveryId !== "string") return NextResponse.json({error:"INVALID_REQUEST"},{status:400});
  await hydrateOperationalState({refresh:true});
  const snapshot = getDashboardSnapshot(body.tenantId);
  const original = snapshot.deliveries.find(d => d.id === body.deliveryId && d.status === "sent");
  const item = snapshot.cases.find(c => c.id === original?.caseId);
  if (!original || !item || !getNotificationSettings(body.tenantId).recipients.includes(original.recipient)) return NextResponse.json({error:"DELIVERY_NOT_AVAILABLE"},{status:404});
  if (!process.env.RESEND_API_KEY) return NextResponse.json({error:"EMAIL_NOT_CONFIGURED"},{status:503});
  // Stable per original delivery: retries cannot send another example.
  const id = `example-v2-${original.id}`;
  const previous = snapshot.deliveries.find(d => d.id === id && d.status === "sent");
  const resend = new Resend(process.env.RESEND_API_KEY);
  let providerId = previous?.providerId;
  if (!providerId) {
    const content = buildAlertEmail(item, process.env.APP_URL ?? "https://fraud-systems.vercel.app");
    const sent = await resend.emails.send({from:process.env.EMAIL_FROM ?? "ShopShield <alerts@shopshield.click>",to:[original.recipient],...content,
      subject:`שליחה חוזרת לדוגמה — ${content.subject}`,
      text:`עותק לדוגמה של התראה קודמת, לא אירוע חדש.\n\n${content.text}`,
      html:`<p dir="rtl">עותק לדוגמה של התראה קודמת, לא אירוע חדש.</p>${content.html}`,
    },{headers:{"Idempotency-Key":id}});
    if (sent.error || !sent.data?.id) return NextResponse.json({error:"SEND_FAILED"},{status:502});
    providerId=sent.data.id;
    recordNotificationDelivery({id,tenantId:body.tenantId,caseId:item.id,recipient:original.recipient,status:"sent",createdAt:new Date().toISOString(),providerId});
    await persistOperationalState();
  }
  const status = await resend.emails.get(providerId).catch(() => null);
  return NextResponse.json({sent:true,recipient:original.recipient,orderNumber:item.orderNumber,providerId,event:status?.data?.last_event ?? "accepted"});
}
