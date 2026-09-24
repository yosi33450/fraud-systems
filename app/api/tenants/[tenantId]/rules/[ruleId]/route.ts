import { NextResponse } from "next/server";
import { reevaluateOpenCases, updateRule } from "@/lib/operational-store";
import type { RiskRule } from "@/lib/types";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";

export async function PATCH(request: Request, context: { params: Promise<{ tenantId: string; ruleId: string }> }) {
  await hydrateOperationalState();
  const { tenantId, ruleId } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "INVALID_RULE" }, { status: 400 });
  const candidate = body as Partial<RiskRule>;
  const patch: Partial<Pick<RiskRule, "enabled" | "label" | "description" | "logic" | "conditions" | "action">> = {};
  if (typeof candidate.enabled === "boolean") patch.enabled = candidate.enabled;
  if (typeof candidate.label === "string" && candidate.label.trim()) patch.label = candidate.label.trim();
  if (typeof candidate.description === "string") patch.description = candidate.description.trim();
  if (candidate.logic === "all" || candidate.logic === "any") patch.logic = candidate.logic;
  if (Array.isArray(candidate.conditions) && candidate.conditions.length > 0) patch.conditions = candidate.conditions;
  if (candidate.action && typeof candidate.action === "object") patch.action = candidate.action;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "INVALID_RULE" }, { status: 400 });
  try {
    const rule = updateRule(tenantId, ruleId, patch);
    const reconciliation = reevaluateOpenCases(tenantId);
    await persistOperationalState();
    return NextResponse.json({ rule, cases: reconciliation.cases, reconciliation: {
      reviewed: reconciliation.reviewed,
      updated: reconciliation.updated,
      resolved: reconciliation.resolved,
      active: reconciliation.active,
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RULE_UPDATE_FAILED";
    const status = message === "RULE_NOT_FOUND" ? 404 : message === "RULE_LOCKED" ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
