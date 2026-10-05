import { NextResponse } from "next/server";
import { reconcileChargebacksAutomatically } from "@/lib/credimatch-auto-reconcile.server";
import { hydrateCrediMatchChargebacks, persistCrediMatchChargebacks } from "@/lib/credimatch-persistence.server";
import { hydrateOperationalState } from "@/lib/persistence.server";
import { getDashboardSnapshot } from "@/lib/operational-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await context.params;
  const body = await request.json().catch(() => ({})) as { discrepancyId?: unknown };
  if (typeof body.discrepancyId !== "string" || !/^\d{1,30}$/.test(body.discrepancyId)) {
    return NextResponse.json({ error: "INVALID_DISCREPANCY_ID" }, { status: 400 });
  }
  try {
    await hydrateOperationalState({ refresh: true });
    await hydrateCrediMatchChargebacks();
    const item = getDashboardSnapshot(tenantId).chargebacks.find((chargeback) => chargeback.discrepancyId === body.discrepancyId);
    if (!item) return NextResponse.json({ error: "CHARGEBACK_NOT_FOUND" }, { status: 404 });
    if (item.match?.confidence === "exact") return NextResponse.json({ linked: true, complete: true });
    await reconcileChargebacksAutomatically([item], 8);
    await persistCrediMatchChargebacks();
    const latest = getDashboardSnapshot(tenantId).chargebacks.find((chargeback) => chargeback.discrepancyId === body.discrepancyId);
    return NextResponse.json({
      linked: latest?.match?.confidence === "exact",
      complete: !latest?.reconciliationCursor,
      payplusStatus: latest?.payplus?.status ?? "not_checked",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[credimatch-auto-reconcile] failed", { code: error instanceof Error ? error.message : "UNKNOWN" });
    return NextResponse.json({ error: "RECONCILIATION_FAILED" }, { status: 502 });
  }
}
