import { createHash, randomUUID } from "node:crypto";
import { Resend } from "resend";
import { getNotificationSettings, recordNotificationDelivery } from "@/lib/operational-store";
import type { FraudCase, NotificationDelivery } from "@/lib/types";
import { buildAlertEmail } from "@/lib/alert-email";

export async function notifyStoreOwners(item: FraudCase, options: { force?: boolean; test?: boolean } = {}) {
  const settings = getNotificationSettings(item.tenantId);
  if ((!options.force && (!settings.enabled || !settings.severities.includes(item.severity))) || settings.recipients.length === 0) return [];
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
          from: process.env.EMAIL_FROM ?? "ShopShield <alerts@shopshield.click>",
          to: [recipient],
          ...buildAlertEmail(item, process.env.APP_URL ?? "https://fraud-systems.vercel.app", options.test),
        }, { headers: { "Idempotency-Key": `risk-alert-${alertRevision}-${recipient}` } });
        if (result.error) {
          console.error("[email-notification] Resend rejected email", {
            recipient,
            name: result.error.name,
            message: result.error.message,
          });
          delivery.status = "failed";
        } else {
          delivery.status = "sent";
          delivery.providerId = result.data?.id;
        }
      } catch (error) {
        console.error("[email-notification] Resend request failed", {
          recipient,
          error: error instanceof Error ? error.message : String(error),
        });
        delivery.status = "failed";
      }
    }
    recordNotificationDelivery(delivery);
    deliveries.push(delivery);
  }
  return deliveries;
}

export async function sendTestNotification(tenantId: string) {
  const settings = getNotificationSettings(tenantId);
  if (settings.recipients.length === 0) return [];
  const now = new Date().toISOString();
  return notifyStoreOwners({
    id: `test-${randomUUID()}`, tenantId, storeId: "test-store", storeName: "בדיקת ShopShield",
    orderNumber: "#TEST", customer: "זו הודעת בדיקה", email: "test@shopshield.local", amount: 0,
    score: 0, severity: "high", status: "new", reason: "בדיקת קבלת התראות באימייל",
    createdAt: now, occurredAt: now, evidence: [], items: [], context: { paymentGateways: [], riskFacts: [] },
  }, { force: true, test: true });
}
