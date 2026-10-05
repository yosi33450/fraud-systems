import { NextResponse } from "next/server";
import { reconcileChargebacksAutomatically, pendingAutomaticChargebacks } from "@/lib/credimatch-auto-reconcile.server";
import { hydrateCrediMatchChargebacks, persistCrediMatchChargebacks } from "@/lib/credimatch-persistence.server";
import { hydrateOperationalState } from "@/lib/persistence.server";
import { exportCrediMatchChargebacks } from "@/lib/operational-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    await hydrateOperationalState({ refresh: true });
    await hydrateCrediMatchChargebacks();
    const tenantIds = [...new Set(exportCrediMatchChargebacks().map((item) => item.tenantId))];
    const pending = tenantIds.flatMap((tenantId) => pendingAutomaticChargebacks(tenantId, 5)).slice(0, 5);
    const result = await reconcileChargebacksAutomatically(pending, 8);
    if (result.checked) await persistCrediMatchChargebacks();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[credimatch-cron] failed", { code: error instanceof Error ? error.message : "UNKNOWN" });
    return NextResponse.json({ error: "RECONCILIATION_FAILED" }, { status: 502 });
  }
}
