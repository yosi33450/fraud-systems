import { NextResponse } from "next/server";
import { hydrateCrediMatchChargebacks, persistCrediMatchChargebacks } from "@/lib/credimatch-persistence.server";
import { hydrateOperationalState } from "@/lib/persistence.server";
import { getFreshStoreConnection } from "@/lib/shopify-connection.server";
import { syncCrediMatchOrderCandidatesPage, syncCrediMatchTenderCandidatesPage } from "@/lib/shopify-sync.server";
import { getCrediMatchTransaction } from "@/lib/credimatch.server";
import { crediMatchTransactionTime, crediMatchTransactionTimeIsPrecise, crediMatchTransactionUid } from "@/lib/credimatch-matching";
import { exportCrediMatchChargebacks, getDashboardSnapshot, restoreCrediMatchChargebacks } from "@/lib/operational-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await context.params;
  try {
    const body = await request.json().catch(() => ({})) as {
      storeId?: string;
      since?: string;
      until?: string;
      after?: string | null;
      scanned?: number;
      exactReferenceScan?: boolean;
      tenderReferenceScan?: boolean;
      referenceSearchDiscrepancyId?: string;
    };
    const sinceTime = typeof body.since === "string" ? Date.parse(body.since) : NaN;
    const untilTime = typeof body.until === "string" ? Date.parse(body.until) : NaN;
    const now = Date.now();
    if (!body.storeId || !Number.isFinite(sinceTime) || !Number.isFinite(untilTime)
      || sinceTime > untilTime || untilTime > now + DAY || now - sinceTime > 370 * DAY) {
      return NextResponse.json({ error: "INVALID_BACKFILL_RANGE" }, { status: 400 });
    }
    if (body.after !== undefined && body.after !== null && (typeof body.after !== "string" || body.after.length > 2_048)) {
      return NextResponse.json({ error: "INVALID_BACKFILL_CURSOR" }, { status: 400 });
    }
    if (body.referenceSearchDiscrepancyId && !/^\d{1,30}$/.test(body.referenceSearchDiscrepancyId)) {
      return NextResponse.json({ error: "INVALID_DISCREPANCY_ID" }, { status: 400 });
    }
    const scanned = Number.isSafeInteger(body.scanned) && Number(body.scanned) >= 0 && Number(body.scanned) <= 1_000_000
      ? Number(body.scanned)
      : 0;

    await hydrateOperationalState({ refresh: true });
    await hydrateCrediMatchChargebacks();
    const referenceChargeback = body.referenceSearchDiscrepancyId
      ? exportCrediMatchChargebacks().find((item) => item.tenantId === tenantId && item.discrepancyId === body.referenceSearchDiscrepancyId)
      : undefined;
    const merchantReference = referenceChargeback?.payplus?.status === "found" ? referenceChargeback.payplus.merchantReference : undefined;
    if (body.referenceSearchDiscrepancyId && (!merchantReference || !/^[a-z0-9_-]{6,100}$/i.test(merchantReference))) {
      return NextResponse.json({ error: "PAYPLUS_REFERENCE_UNAVAILABLE" }, { status: 400 });
    }
    if (!body.after && !body.exactReferenceScan && !body.tenderReferenceScan && !body.referenceSearchDiscrepancyId) {
      const apiChargebacks = exportCrediMatchChargebacks().filter((chargeback) =>
        chargeback.tenantId === tenantId && chargeback.transactionId);
      for (let index = 0; index < apiChargebacks.length; index += 5) {
        const batch = apiChargebacks.slice(index, index + 5);
        const hydrated = await Promise.all(batch.map(async (chargeback) => {
          try {
            const transaction = await getCrediMatchTransaction(chargeback.transactionId!);
            const transactionTime = crediMatchTransactionTime(transaction);
            return {
              ...chargeback,
              providerUid: crediMatchTransactionUid(transaction) ?? chargeback.providerUid,
              dealTime: transactionTime ?? chargeback.dealTime,
              dealTimePrecise: transactionTime ? crediMatchTransactionTimeIsPrecise(transactionTime) : chargeback.dealTimePrecise,
            };
          } catch (error) {
            console.warn("[credimatch-backfill] transaction uid unavailable", {
              transactionId: chargeback.transactionId,
              code: error instanceof Error ? error.message : "UNKNOWN",
            });
            return chargeback;
          }
        }));
        restoreCrediMatchChargebacks(hydrated);
      }
      console.info("[credimatch-backfill] CrediMatch uid coverage", {
        chargebacks: exportCrediMatchChargebacks().filter((item) => item.tenantId === tenantId).length,
        providerUids: exportCrediMatchChargebacks().filter((item) => item.tenantId === tenantId && item.providerUid).length,
      });
    }
    const connection = await getFreshStoreConnection(tenantId, body.storeId);
    const range = {
      tenantId,
      storeId: body.storeId,
      shopDomain: connection.store.domain,
      accessToken: connection.accessToken,
      since: new Date(sinceTime).toISOString(),
      until: new Date(untilTime).toISOString(),
      after: body.after ?? null,
      scanned,
    };
    const result = body.tenderReferenceScan ? await syncCrediMatchTenderCandidatesPage(range) : await syncCrediMatchOrderCandidatesPage({
      ...range,
      searchQuery: merchantReference ?? (body.exactReferenceScan
        ? `created_at:>=${new Date(sinceTime).toISOString()} created_at:<=${new Date(untilTime).toISOString()}`
        : undefined),
    });
    await persistCrediMatchChargebacks();
    const linked = body.referenceSearchDiscrepancyId
      ? getDashboardSnapshot(tenantId).chargebacks.find((item) => item.discrepancyId === body.referenceSearchDiscrepancyId)?.match?.confidence === "exact"
      : undefined;
    return NextResponse.json({ ...result, linked }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CREDIMATCH_BACKFILL_FAILED";
    console.error("[credimatch-backfill] failed", { tenantId, code: message });
    return NextResponse.json(
      { error: message },
      { status: message === "SHOPIFY_READ_ALL_ORDERS_REQUIRED" ? 403 : 502 },
    );
  }
}
