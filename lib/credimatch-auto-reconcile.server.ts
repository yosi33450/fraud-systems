import { enrichChargebackFromPayPlus, lookUpPayPlusPayment, payPlusConfigured } from "@/lib/payplus.server";
import { exportCrediMatchChargebacks, getDashboardSnapshot, restoreCrediMatchChargebacks } from "@/lib/operational-store";
import { getFreshStoreConnection } from "@/lib/shopify-connection.server";
import { syncCrediMatchOrderCandidatesPage } from "@/lib/shopify-sync.server";
import type { CrediMatchChargeback } from "@/lib/types";

const DAY = 86_400_000;

export function pendingAutomaticChargebacks(tenantId: string, limit = 5) {
  if (!payPlusConfigured()) return [];
  const snapshot = getDashboardSnapshot(tenantId);
  return snapshot.chargebacks.filter((item) => {
    if (!item.confirmationNumber || item.match?.confidence === "exact") return false;
    const checkedAt = Date.parse(item.payplus?.checkedAt ?? "");
    return Boolean(item.reconciliationCursor) || !Number.isFinite(checkedAt) || Date.now() - checkedAt >= DAY;
  }).sort((left, right) => {
    const leftChecked = Date.parse(left.payplus?.checkedAt ?? "") || 0;
    const rightChecked = Date.parse(right.payplus?.checkedAt ?? "") || 0;
    return leftChecked - rightChecked;
  }).slice(0, limit);
}

export async function reconcileChargebacksAutomatically(chargebacks: CrediMatchChargeback[], maxPages = 8) {
  if (!chargebacks.length || !payPlusConfigured()) return { checked: 0, linked: 0, deferred: 0 };
  let linked = 0;
  let deferred = 0;
  for (const chargeback of chargebacks) {
    const latest = exportCrediMatchChargebacks().find((item) => item.tenantId === chargeback.tenantId && item.discrepancyId === chargeback.discrepancyId) ?? chargeback;
    const payplus = latest.payplus?.status === "found" && latest.payplus.merchantReference
      ? latest.payplus : await lookUpPayPlusPayment(latest);
    const enriched = enrichChargebackFromPayPlus(latest, { ...payplus, checkedAt: new Date().toISOString() });
    restoreCrediMatchChargebacks([enriched]);
    const paymentTime = Date.parse(enriched.payplus?.paidAt ?? enriched.dealTime ?? "");
    if (!enriched.payplus?.merchantReference || !Number.isFinite(paymentTime)) { deferred += 1; continue; }
    const stores = getDashboardSnapshot(enriched.tenantId).stores.filter((store) => store.status !== "disabled");
    let resumeStoreId = enriched.reconciliationCursor?.storeId;
    let linkedThisChargeback = false;
    for (const store of stores) {
      if (resumeStoreId && resumeStoreId !== store.id) continue;
      try {
        const connection = await getFreshStoreConnection(enriched.tenantId, store.id);
        const since = new Date(paymentTime - 36 * DAY).toISOString();
        const until = new Date(paymentTime + 36 * DAY).toISOString();
        const cardLast4 = enriched.last4Digits?.replace(/\D/g, "").slice(-4);
        const merchantReference = enriched.payplus.merchantReference;
        const phases: Array<"payment" | "card" | "date"> = [
          ...(/^[a-z0-9_-]{6,100}$/i.test(merchantReference) ? ["payment" as const] : []),
          ...(cardLast4?.length === 4 ? ["card" as const] : []),
          "date",
        ];
        let incomplete = false;
        for (const phase of phases) {
          const saved = enriched.reconciliationCursor;
          const resumePhase = saved?.phase ?? "date";
          if (resumeStoreId === store.id && saved && phase !== "payment" && phases.indexOf(phase) < phases.indexOf(resumePhase)) continue;
          let after: string | null = resumeStoreId === store.id && saved && phase === resumePhase ? saved.after : null;
          const dateQuery = `created_at:>=${since} created_at:<=${until}`;
          const searchQuery = phase === "payment" ? `payment_id:${merchantReference}`
            : phase === "card" ? `${dateQuery} credit_card_last4:${cardLast4}` : dateQuery;
          for (let page = 0; page < maxPages; page += 1) {
            const result = await syncCrediMatchOrderCandidatesPage({
              tenantId: enriched.tenantId,
              storeId: store.id,
              shopDomain: connection.store.domain,
              accessToken: connection.accessToken,
              since, until, after, scanned: 0, searchQuery,
            });
            const current = getDashboardSnapshot(enriched.tenantId).chargebacks.find((item) => item.discrepancyId === enriched.discrepancyId);
            if (current?.match?.confidence === "exact") {
              restoreCrediMatchChargebacks([{ ...enriched, reconciliationCursor: undefined }]);
              linked += 1;
              linkedThisChargeback = true;
              break;
            }
            if (result.complete) break;
            if (!result.nextCursor || result.nextCursor === after) throw new Error("SHOPIFY_SYNC_CURSOR_MISSING");
            after = result.nextCursor;
            restoreCrediMatchChargebacks([{ ...enriched, reconciliationCursor: { storeId: store.id, after, phase } }]);
            if (page === maxPages - 1) incomplete = true;
          }
          if (linkedThisChargeback || incomplete) break;
        }
        if (linkedThisChargeback || incomplete) break;
        restoreCrediMatchChargebacks([{ ...enriched, reconciliationCursor: undefined }]);
        resumeStoreId = undefined;
      } catch (error) {
        deferred += 1;
        console.warn("[credimatch-auto] Shopify reconciliation deferred", {
          discrepancyId: enriched.discrepancyId, storeId: store.id,
          code: error instanceof Error ? error.message : "UNKNOWN",
        });
      }
    }
  }
  return { checked: chargebacks.length, linked, deferred };
}
