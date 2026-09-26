import { createHash, randomUUID } from "node:crypto";
import { Resend } from "resend";
import { getNotificationSettings, recordNotificationDelivery } from "@/lib/operational-store";
import type { FraudCase, NotificationDelivery } from "@/lib/types";

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character);

const emailHtml = (item: FraudCase) => `
  <div dir="rtl" style="font-family:Arial,sans-serif;background:#f4f6f4;padding:32px;color:#17211d">
    <div style="max-width:600px;margin:auto;background:white;border:1px solid #dfe5e1;border-radius:16px;padding:28px">
      <div style="font-size:12px;color:#007a5a;font-weight:700">SHIELD LEDGER · התראת סיכון</div>
      <h1 style="font-size:24px;margin:12px 0">נדרשת החלטה לגבי ${escapeHtml(item.orderNumber)}</h1>
      <p style="line-height:1.7;color:#4e5b55">המערכת זיהתה: <strong>${escapeHtml(item.reason)}</strong>. ההזמנה לא תסומן כהונאה אוטומטית — בעל החנות צריך לבדוק ולקבל החלטה.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0"><tr><td style="padding:10px;border-bottom:1px solid #eee">חנות</td><td style="padding:10px;border-bottom:1px solid #eee;font-weight:700">${escapeHtml(item.storeName)}</td></tr><tr><td style="padding:10px;border-bottom:1px solid #eee">לקוח</td><td style="padding:10px;border-bottom:1px solid #eee;font-weight:700">${escapeHtml(item.customer)}</td></tr><tr><td style="padding:10px">סכום</td><td style="padding:10px;font-weight:700">₪${item.amount.toLocaleString("he-IL")}</td></tr></table>
      <a href="${escapeHtml(process.env.APP_URL ?? "http://localhost:3000")}" style="display:inline-block;background:#007a5a;color:white;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:700">פתח את התיק וקבל החלטה</a>
      <p style="font-size:12px;color:#7b8781;margin-top:22px">ניתן לסמן את התיק בבדיקה, כטופל, כתקין או כהונאה מאומתת.</p>
    </div>
  </div>`;

export async function notifyStoreOwners(item: FraudCase) {
  const settings = getNotificationSettings(item.tenantId);
  if (!settings.enabled || !settings.severities.includes(item.severity) || settings.recipients.length === 0) return [];
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  const deliveries: NotificationDelivery[] = [];
  const alertRevision = createHash("sha256").update(JSON.stringify([item.id, item.severity, item.score, item.evidence.map((entry) => entry.label)])).digest("hex").slice(0, 20);

  for (const recipient of settings.recipients) {
    const delivery: NotificationDelivery = {
      id: randomUUID(), tenantId: item.tenantId, caseId: item.id, recipient,
      status: resend ? "queued" : "simulated", createdAt: new Date().toISOString(),
    };
    if (resend) {
      try {
        const result = await resend.emails.send({
          from: process.env.EMAIL_FROM ?? "Shield Ledger <alerts@shieldledger.app>",
          to: recipient,
          subject: `נדרשת בדיקה: ${item.orderNumber} · ${item.storeName}`,
          html: emailHtml(item),
        }, { headers: { "Idempotency-Key": `risk-alert-${alertRevision}-${recipient}` } });
        delivery.status = result.error ? "failed" : "sent";
        delivery.providerId = result.data?.id;
      } catch { delivery.status = "failed"; }
    }
    recordNotificationDelivery(delivery);
    deliveries.push(delivery);
  }
  return deliveries;
}
