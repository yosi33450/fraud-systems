import { NextResponse } from "next/server";
import { createRule } from "@/lib/operational-store";
import type { RiskRule } from "@/lib/types";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";

export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  await hydrateOperationalState();
  const { tenantId } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "INVALID_RULE" }, { status: 400 });
  const rule = body as Partial<RiskRule>;
  if (!rule.label?.trim() || !rule.category || !rule.logic || !Array.isArray(rule.conditions) || rule.conditions.length === 0 || !rule.action) {
    return NextResponse.json({ error: "INVALID_RULE" }, { status: 400 });
  }
  const created = createRule(tenantId, {
    label: rule.label.trim(), description: rule.description?.trim() ?? "", category: rule.category,
    enabled: rule.enabled ?? true, logic: rule.logic, conditions: rule.conditions, action: rule.action,
    locked: false, recommended: false,
  });
  await persistOperationalState();
  return NextResponse.json({ rule: created }, { status: 201 });
}
