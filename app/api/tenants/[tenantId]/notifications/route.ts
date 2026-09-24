import { NextResponse } from "next/server";
import { getNotificationSettings, updateNotificationSettings } from "@/lib/operational-store";
import type { NotificationSettings, Severity } from "@/lib/types";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";

const severityValues = new Set<Severity>(["low", "medium", "high", "critical"]);

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  await hydrateOperationalState();
  const { tenantId } = await context.params;
  return NextResponse.json({ notifications: getNotificationSettings(tenantId) });
}

export async function PATCH(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  await hydrateOperationalState();
  const { tenantId } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "INVALID_NOTIFICATION_SETTINGS" }, { status: 400 });
  const input = body as Partial<NotificationSettings>;
  const patch: Partial<Omit<NotificationSettings, "tenantId">> = {};
  if (typeof input.enabled === "boolean") patch.enabled = input.enabled;
  if (Array.isArray(input.recipients) && input.recipients.every((value) => typeof value === "string" && /^\S+@\S+\.\S+$/.test(value))) patch.recipients = input.recipients;
  if (Array.isArray(input.severities) && input.severities.every((value) => severityValues.has(value))) patch.severities = input.severities;
  if (typeof input.reminderMinutes === "number" && input.reminderMinutes >= 5 && input.reminderMinutes <= 1440) patch.reminderMinutes = input.reminderMinutes;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "INVALID_NOTIFICATION_SETTINGS" }, { status: 400 });
  const notifications = updateNotificationSettings(tenantId, patch);
  await persistOperationalState();
  return NextResponse.json({ notifications });
}
