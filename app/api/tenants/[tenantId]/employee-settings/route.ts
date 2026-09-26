import { NextResponse } from "next/server";
import { getEmployeeSettings, saveEmployeeSettings } from "@/lib/operational-store";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";
import type { EmployeeMonitoringSettings } from "@/lib/types";

export async function PATCH(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  await hydrateOperationalState();
  const { tenantId } = await context.params;
  const candidate: unknown = await request.json().catch(() => null);
  if (!candidate || typeof candidate !== "object") return NextResponse.json({ error: "INVALID_SETTINGS" }, { status: 400 });
  const input = candidate as Partial<EmployeeMonitoringSettings>;
  if (typeof input.couponPrefix !== "string" || !/^[a-z0-9_-]{0,24}$/i.test(input.couponPrefix)
    || typeof input.zeroAmount !== "boolean" || typeof input.giftCardAddressChange !== "boolean" || typeof input.repeatGiftCardUses !== "boolean"
    || !Number.isFinite(input.repeatUsesThreshold) || !Number.isFinite(input.windowMinutes)) {
    return NextResponse.json({ error: "INVALID_SETTINGS" }, { status: 400 });
  }
  const settings = saveEmployeeSettings(tenantId, { ...getEmployeeSettings(tenantId), ...input });
  await persistOperationalState();
  return NextResponse.json({ settings });
}
