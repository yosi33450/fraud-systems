import { NextResponse } from "next/server";
import { CrediMatchApiError, CrediMatchConfigurationError, getCrediMatchDiscrepancy, getCrediMatchTransaction } from "@/lib/credimatch.server";
import { crediMatchTransactionIds } from "@/lib/credimatch-matching";
import { CrediMatchWebhookValidationError, parseCrediMatchWebhook } from "@/lib/credimatch-webhook";
import { exportCrediMatchChargebacks, getDashboardSnapshot, recordCrediMatchDiscrepancy, restoreCrediMatchChargebacks } from "@/lib/operational-store";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";
import { hydrateCrediMatchChargebacks, persistCrediMatchChargebacks } from "@/lib/credimatch-persistence.server";
import { enrichChargebackFromPayPlus, lookUpPayPlusPayment, payPlusConfigured } from "@/lib/payplus.server";
import { getFreshStoreConnection } from "@/lib/shopify-connection.server";
import { syncCrediMatchOrderCandidatesPage } from "@/lib/shopify-sync.server";
import type { CrediMatchChargeback } from "@/lib/types";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 64_000;

const responseShape = (payload: unknown) => {
  if (Array.isArray(payload)) return { type: "array", count: payload.length };
  if (payload && typeof payload === "object") return { type: "object", keys: Object.keys(payload).slice(0, 20) };
  return { type: typeof payload };
};

/**
 * A new CrediMatch event is reconciled immediately, without requiring a user
 * to press either PayPlus or historical-search buttons.  The search is kept
 * deliberately small: PayPlus supplies the reference and the payment date,
 * then Shopify is queried only around that payment date.  The eventual match
 * remains reference-only (`more_info` <-> `remoteReference`).
 */
async function reconcileReceivedChargebacks(chargebacks: CrediMatchChargeback[]) {
  if (!chargebacks.length || !payPlusConfigured()) return;
  const enriched: CrediMatchChargeback[] = [];
  for (let index = 0; index < chargebacks.length; index += 3) {
    const batch = await Promise.all(chargebacks.slice(index, index + 3).map(async (chargeback) =>
      enrichChargebackFromPayPlus(chargeback, await lookUpPayPlusPayment(chargeback))));
    enriched.push(...batch);
  }
  restoreCrediMatchChargebacks(enriched);

  for (const chargeback of enriched) {
    const paymentTime = Date.parse(chargeback.payplus?.paidAt ?? chargeback.dealTime ?? "");
    if (!chargeback.payplus?.merchantReference || !Number.isFinite(paymentTime)) continue;
    const snapshot = getDashboardSnapshot(chargeback.tenantId);
    for (const store of snapshot.stores.filter((item) => item.status !== "disabled")) {
      try {
        const connection = await getFreshStoreConnection(chargeback.tenantId, store.id);
        await syncCrediMatchOrderCandidatesPage({
          tenantId: chargeback.tenantId,
          storeId: store.id,
          shopDomain: connection.store.domain,
          accessToken: connection.accessToken,
          // A compact window makes a live reconciliation fast even in a busy
          // store.  It is not used as proof of a match; only `more_info` is.
          since: new Date(paymentTime - 36 * 86_400_000).toISOString(),
          until: new Date(paymentTime + 36 * 86_400_000).toISOString(),
          scanned: 0,
        });
      } catch (error) {
        console.warn("[credimatch-webhook] automatic Shopify reconciliation deferred", {
          discrepancyId: chargeback.discrepancyId,
          storeId: store.id,
          code: error instanceof Error ? error.message : "UNKNOWN",
        });
      }
    }
  }
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "WEBHOOK_PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
      return NextResponse.json({ error: "WEBHOOK_PAYLOAD_TOO_LARGE" }, { status: 413 });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new CrediMatchWebhookValidationError("CREDIMATCH_WEBHOOK_JSON_INVALID");
    }
    const { discrepancyIds, ignoredEvents } = parseCrediMatchWebhook(payload);
    if (discrepancyIds.length === 0) {
      return NextResponse.json({ accepted: true, processed: 0, duplicates: 0, ignoredEvents }, { status: 202 });
    }

    await hydrateOperationalState({ refresh: true });
    await hydrateCrediMatchChargebacks();
    let duplicates = 0;
    const receivedIds = new Set<string>();
    for (const discrepancyId of discrepancyIds) {
      const discrepancy = await getCrediMatchDiscrepancy(discrepancyId);
      const transactions = await Promise.all(crediMatchTransactionIds(discrepancy).map((transactionId) => getCrediMatchTransaction(transactionId)));
      const result = recordCrediMatchDiscrepancy(discrepancyId, discrepancy, transactions);
      if (result.duplicate) duplicates += 1;
      else receivedIds.add(discrepancyId);
      console.info("[credimatch-webhook] discrepancy received", { discrepancyId, duplicate: result.duplicate, transactions: transactions.length, response: responseShape(discrepancy) });
    }
    await reconcileReceivedChargebacks(exportCrediMatchChargebacks().filter((item) => receivedIds.has(item.discrepancyId)));
    await persistCrediMatchChargebacks();
    await persistOperationalState();
    return NextResponse.json({ accepted: true, processed: discrepancyIds.length - duplicates, duplicates, ignoredEvents }, { status: 202 });
  } catch (error) {
    if (error instanceof CrediMatchWebhookValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof CrediMatchConfigurationError) {
      console.error("[credimatch-webhook] configuration error", { code: error.message });
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof CrediMatchApiError) {
      console.error("[credimatch-webhook] API request failed", { code: error.message, status: error.status });
      return NextResponse.json({ error: "CREDIMATCH_UPSTREAM_FAILED" }, { status: 502 });
    }
    const message = error instanceof Error ? error.message : "CREDIMATCH_WEBHOOK_FAILED";
    console.error("[credimatch-webhook] processing failed", { code: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
