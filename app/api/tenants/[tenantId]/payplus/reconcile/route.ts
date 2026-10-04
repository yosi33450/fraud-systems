import { NextResponse } from "next/server";
import { hydrateCrediMatchChargebacks, persistCrediMatchChargebacks } from "@/lib/credimatch-persistence.server";
import { enrichChargebackFromPayPlus, lookUpPayPlusPayment, payPlusConfigured } from "@/lib/payplus.server";
import { hydrateOperationalState } from "@/lib/persistence.server";
import { exportCrediMatchChargebacks, restoreCrediMatchChargebacks } from "@/lib/operational-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await context.params;
  if (!payPlusConfigured()) return NextResponse.json({ error: "PAYPLUS_NOT_CONFIGURED" }, { status: 503 });
  try {
    await hydrateOperationalState({ refresh: true });
    await hydrateCrediMatchChargebacks();
    const source = exportCrediMatchChargebacks().filter((item) => item.tenantId === tenantId && item.confirmationNumber);
    const updated = [];
    let found = 0; let notFound = 0; let conflicts = 0; let errors = 0;
    for (let index = 0; index < source.length; index += 3) {
      const batch = await Promise.all(source.slice(index, index + 3).map(async (chargeback) => {
        const payplus = await lookUpPayPlusPayment(chargeback);
        if (payplus.status === "found") found += 1;
        else if (payplus.status === "conflict") conflicts += 1;
        else if (payplus.status === "error") errors += 1;
        else notFound += 1;
        return enrichChargebackFromPayPlus(chargeback, payplus);
      }));
      updated.push(...batch);
    }
    restoreCrediMatchChargebacks(updated);
    await persistCrediMatchChargebacks();
    return NextResponse.json({ checked: source.length, found, notFound, conflicts, errors }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PAYPLUS_RECONCILIATION_FAILED";
    console.error("[payplus-reconcile] failed", { tenantId, code });
    return NextResponse.json({ error: code }, { status: 502 });
  }
}
