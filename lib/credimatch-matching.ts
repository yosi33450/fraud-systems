import type {
  ChargebackMatchComparison,
  ChargebackOrderMatch,
  CrediMatchChargeback,
  CrediMatchSettlement,
  OrderPaymentFingerprint,
} from "@/lib/types";

type UnknownRecord = Record<string, unknown>;

export type MatchableShopifyOrder = {
  storeId: string;
  storeName?: string;
  shopifyOrderId: string;
  orderNumber?: string;
  customer?: string;
  email: string;
  amount: number;
  currency?: string;
  createdAt: string;
  payments?: OrderPaymentFingerprint[];
};

const record = (value: unknown): UnknownRecord | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
const array = (value: unknown) => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim() || undefined : undefined;
const number = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};
const description = (value: unknown) => text(record(value)?.description);
const normalizedId = (value: unknown) => {
  const normalized = text(value)?.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalized && /^\d+$/.test(normalized) ? normalized.replace(/^0+(?=\d)/, "") : normalized;
};
const last4 = (value: unknown) => text(value)?.replace(/\D/g, "").slice(-4) || undefined;
const normalizedCurrency = (value: unknown) => {
  const candidate = text(value)?.toUpperCase();
  if (!candidate) return undefined;
  if (/ILS|NIS|שקל/.test(candidate)) return "ILS";
  if (/USD|דולר/.test(candidate)) return "USD";
  if (/EUR|אירו|יורו/.test(candidate)) return "EUR";
  return /^[A-Z]{3}$/.test(candidate) ? candidate : undefined;
};

function receiptObject(value: unknown): UnknownRecord | undefined {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return undefined; }
  }
  return record(value);
}

function flattenedReceipt(value: unknown, depth = 0): Array<[string, unknown]> {
  if (depth > 4) return [];
  const source = receiptObject(value);
  if (!source) return [];
  return Object.entries(source).flatMap(([key, entry]) => {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return [[normalized, entry] as [string, unknown], ...flattenedReceipt(entry, depth + 1)];
  });
}

const receiptValue = (receipt: unknown, keys: string[]) => {
  const accepted = new Set(keys.map((key) => key.replace(/[^a-z0-9]/gi, "").toLowerCase()));
  return flattenedReceipt(receipt).find(([key, value]) => accepted.has(key) && text(value))?.[1];
};

export function paymentFingerprintsFromShopify(
  transactions: Array<{ id?: string; payment_id?: string; gateway_reference?: string; gateway?: string; formatted_gateway?: string; account_number?: string; payment_details?: { number?: string | null } | null; authorization_code?: string; amount?: string | number; processed_at?: string; receipt?: unknown }>,
  fallbackCurrency?: string,
): OrderPaymentFingerprint[] {
  return transactions.map((transaction) => ({
    transactionId: text(transaction.id),
    paymentId: text(transaction.payment_id),
    gatewayReference: text(transaction.gateway_reference ?? receiptValue(transaction.receipt, ["payment_id", "paymentId", "uid", "transaction_uid", "transactionUid"])),
    gateway: text(transaction.formatted_gateway ?? transaction.gateway),
    amount: number(transaction.amount),
    currency: normalizedCurrency(receiptValue(transaction.receipt, ["currency", "currencyCode"])) ?? normalizedCurrency(fallbackCurrency),
    processedAt: text(transaction.processed_at),
    last4: last4(transaction.account_number ?? transaction.payment_details?.number ?? receiptValue(transaction.receipt, ["last4", "lastFour", "last_four", "creditCardSuffix", "cardSuffix"])),
    confirmationNumber: text(transaction.authorization_code ?? receiptValue(transaction.receipt, ["confirmationNumber", "authorization", "authorizationCode", "authCode", "approvalCode"])),
    voucherNumber: text(receiptValue(transaction.receipt, ["voucherNumber", "voucher", "shovar"])),
    terminalNumber: text(receiptValue(transaction.receipt, ["terminalNumber", "terminalId", "terminal"])),
    sessionNumber: text(receiptValue(transaction.receipt, ["sessionNumber", "sessionId", "session"])),
  })).filter((payment) => Object.values(payment).some(Boolean));
}

export function shopifyChargebackSearchQuery(input: {
  since: string;
  until: string;
  chargebacks: Array<Pick<CrediMatchChargeback, "originalAmount" | "grossAmount">>;
}) {
  const amounts = [...new Set(input.chargebacks.map((item) => item.originalAmount ?? item.grossAmount)
    .filter((value): value is number => Number.isFinite(value))
    .map((value) => Math.abs(value).toFixed(2)))];
  const dateRange = `created_at:>=${input.since} created_at:<=${input.until}`;
  return amounts.length
    ? `${dateRange} (${amounts.map((value) => `current_total_price:${value}`).join(" OR ")})`
    : dateRange;
}

const settlement = (value: unknown): CrediMatchSettlement | null => {
  const item = record(value);
  if (!item) return null;
  return {
    expectedPaymentTime: text(item.expectedPaymentTime), actualPaymentTime: text(item.actualPaymentTime),
    grossAmount: number(item.grossAmount), expectedNetAmount: number(item.expectedNetAmount), netAmount: number(item.netAmount),
    regularCommissionAmount: number(item.regularCommissionAmount), vat: number(item.vat),
    currentPaymentNumber: number(item.currentPaymentNumber), invoiceNumber: number(item.invoiceNumber),
    invoiceDate: text(item.invoiceDate), receptionStatus: text(item.receptionStatus),
  };
};

export function crediMatchTransactionIds(payload: unknown): string[] {
  const root = record(payload);
  return [...new Set(array(root?.discrepancies).map((entry) => text(record(entry)?.transactionId)).filter((value): value is string => Boolean(value)))];
}

export function crediMatchTransactionUid(payload: unknown): string | undefined {
  const transaction = array(record(payload)?.transactions).map(record).find((item): item is UnknownRecord => Boolean(item));
  return text(transaction?.uid);
}

export function crediMatchTransactionTime(payload: unknown): string | undefined {
  const transaction = array(record(payload)?.transactions).map(record).find((item): item is UnknownRecord => Boolean(item));
  return text(transaction?.transactionDate);
}

export function crediMatchTransactionTimeIsPrecise(value: unknown): boolean {
  const candidate = text(value);
  if (!candidate || !Number.isFinite(Date.parse(candidate))) return false;
  return !/(?:T|\s)00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(candidate);
}

export function normalizeCrediMatchChargebacks(input: {
  tenantId: string;
  discrepancyId: string;
  discrepancyPayload: unknown;
  transactionPayloads?: unknown[];
  receivedAt?: string;
}): CrediMatchChargeback[] {
  const root = record(input.discrepancyPayload);
  const discrepancies = array(root?.discrepancies).map(record).filter((item): item is UnknownRecord => Boolean(item));
  const transactionItems = (input.transactionPayloads ?? []).flatMap((payload) => array(record(payload)?.transactions)).map(record).filter((item): item is UnknownRecord => Boolean(item));
  const source = discrepancies.length ? discrepancies : [{ id: input.discrepancyId }];
  return source.filter((item) => text(item.id) === input.discrepancyId || source.length === 1).map((item) => {
    const transactionId = text(item.transactionId);
    const transaction = transactionItems.find((candidate) => text(candidate.id) === transactionId) ?? transactionItems[0];
    const currency = record(transaction?.currency);
    return {
      id: `credimatch-${text(item.id) ?? input.discrepancyId}`,
      tenantId: input.tenantId,
      discrepancyId: text(item.id) ?? input.discrepancyId,
      transactionId,
      providerUid: text(transaction?.uid),
      receivedAt: input.receivedAt ?? new Date().toISOString(),
      dealTime: text(transaction?.transactionDate) ?? text(item.dealTime), dealTimePrecise: crediMatchTransactionTimeIsPrecise(transaction?.transactionDate), creationTime: text(item.creationTime), originalAmount: number(item.originalAmount), payments: number(item.payments) ?? number(transaction?.numberOfPayments),
      status: description(item.discrepancyStatus), type: description(item.discrepancyType), creditCompany: description(item.creditCompany),
      last4Digits: last4(item.last4Digits ?? transaction?.creditCardSufix), terminalNumber: text(item.terminalNumber ?? transaction?.terminalNumber), confirmationNumber: text(item.confirmationNumber ?? transaction?.confirmationNumber),
      voucherNumber: text(item.voucherNumber), sessionNumber: text(item.sessionNumber), additionalDetails: text(item.additionalDetails),
      inquiryReason: text(item.inquiryReason), comment: text(item.comment),
      currency: normalizedCurrency(currency?.translatedCurrencyType) ?? normalizedCurrency(currency?.currencyTypeId), cardVendor: text(transaction?.creditCardVendor), cardBrand: text(transaction?.creditCardBrand),
      grossAmount: number(transaction?.grossAmount), netAmount: number(transaction?.netAmount), transactionType: text(record(transaction?.transactionType)?.translatedTransactionType),
      settlements: array(transaction?.creditAndDebits).map(settlement).filter((entry): entry is CrediMatchSettlement => Boolean(entry)),
    } satisfies CrediMatchChargeback;
  });
}

const sameNumber = (left?: string, right?: string) => Boolean(left && right && normalizedId(left) === normalizedId(right));
const sameMoney = (left?: number, right?: number) => left !== undefined && right !== undefined && Math.abs(left - right) < 0.01;
const timeDistance = (left?: string, right?: string) => {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const distance = Math.abs(Date.parse(left) - Date.parse(right));
  return Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
};
const israelDayFormatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Jerusalem" });
const israelDayCache = new Map<string, string | undefined>();
const israelDay = (value?: string) => {
  if (!value) return undefined;
  if (israelDayCache.has(value)) return israelDayCache.get(value);
  if (!Number.isFinite(Date.parse(value))) {
    israelDayCache.set(value, undefined);
    return undefined;
  }
  const parts = israelDayFormatter.formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const year = part("year"); const month = part("month"); const day = part("day");
  const result = year && month && day ? `${year}-${month}-${day}` : undefined;
  israelDayCache.set(value, result);
  return result;
};
const displayTime = (distance: number) => distance <= 15 * 60_000 ? "עד 15 דקות" : distance <= 86_400_000 ? "באותו יום" : "עד 3 ימים";

export function matchCrediMatchChargeback(chargeback: CrediMatchChargeback, orders: MatchableShopifyOrder[]): ChargebackOrderMatch {
  const candidates = orders.map((order) => {
    const paymentOptions = order.payments?.length ? order.payments : [{}];
    return paymentOptions.map((payment) => {
      const comparisons: ChargebackMatchComparison[] = [];
      let score = 0;
      const amount = chargeback.originalAmount ?? chargeback.grossAmount;
      const paymentAmount = payment.amount ?? order.amount;
      const provider = sameNumber(chargeback.providerUid, payment.paymentId)
        || sameNumber(chargeback.providerUid, payment.gatewayReference);
      const confirmation = sameNumber(chargeback.confirmationNumber, payment.confirmationNumber)
        || sameNumber(chargeback.confirmationNumber, payment.gatewayReference);
      const voucher = sameNumber(chargeback.voucherNumber, payment.voucherNumber)
        || sameNumber(chargeback.voucherNumber, payment.gatewayReference);
      const card = Boolean(chargeback.last4Digits && payment.last4 && chargeback.last4Digits === payment.last4);
      const cardConflict = Boolean(chargeback.last4Digits && payment.last4 && chargeback.last4Digits !== payment.last4);
      const amountMatch = sameMoney(amount, paymentAmount);
      const currency = Boolean(chargeback.currency && (payment.currency ?? order.currency) && chargeback.currency === (payment.currency ?? order.currency)?.toUpperCase());
      const terminal = sameNumber(chargeback.terminalNumber, payment.terminalNumber);
      const session = sameNumber(chargeback.sessionNumber, payment.sessionNumber);
      const distance = timeDistance(chargeback.dealTime, payment.processedAt ?? order.createdAt);
      const preciseTime = chargeback.dealTimePrecise === true && distance <= 15 * 60_000;
      const time = distance <= 3 * 86_400_000;
      const sameDay = israelDay(chargeback.dealTime) === israelDay(payment.processedAt ?? order.createdAt);
      if (provider) score += 100;
      if (confirmation) score += 80;
      if (voucher) score += 75;
      if (card) score += 25;
      if (amountMatch) score += 25;
      if (currency) score += 5;
      if (terminal) score += 8;
      if (session) score += 20;
      if (distance <= 15 * 60_000) score += 20; else if (distance <= 86_400_000) score += 12; else if (time) score += 5;
      const add = (key: ChargebackMatchComparison["key"], label: string, matched: boolean, crediMatchValue?: string, shopifyValue?: string, compared = Boolean(crediMatchValue && shopifyValue)) => {
        if (crediMatchValue || shopifyValue) comparisons.push({ key, label, matched, compared, crediMatchValue, shopifyValue });
      };
      add("provider", "מזהה עסקה", provider, chargeback.providerUid, payment.gatewayReference ?? payment.paymentId, Boolean(normalizedId(chargeback.providerUid) && normalizedId(payment.gatewayReference ?? payment.paymentId)));
      add("confirmation", "מספר אישור", confirmation, chargeback.confirmationNumber, payment.confirmationNumber ?? payment.gatewayReference, Boolean(normalizedId(chargeback.confirmationNumber) && normalizedId(payment.confirmationNumber ?? payment.gatewayReference)));
      add("voucher", "מספר שובר", voucher, chargeback.voucherNumber, payment.voucherNumber ?? payment.gatewayReference, Boolean(normalizedId(chargeback.voucherNumber) && normalizedId(payment.voucherNumber ?? payment.gatewayReference)));
      add("last4", "4 ספרות אחרונות", card, chargeback.last4Digits ? `•••• ${chargeback.last4Digits}` : undefined, payment.last4 ? `•••• ${payment.last4}` : undefined, Boolean(chargeback.last4Digits && payment.last4));
      add("amount", "סכום", amountMatch, amount?.toFixed(2), paymentAmount?.toFixed(2), amount !== undefined && paymentAmount !== undefined);
      add("currency", "מטבע", currency, chargeback.currency, payment.currency ?? order.currency, Boolean(normalizedCurrency(chargeback.currency) && normalizedCurrency(payment.currency ?? order.currency)));
      add("time", "מועד העסקה", time, chargeback.dealTime, payment.processedAt ?? order.createdAt, Boolean(chargeback.dealTime && (payment.processedAt ?? order.createdAt) && Number.isFinite(Date.parse(chargeback.dealTime)) && Number.isFinite(Date.parse(payment.processedAt ?? order.createdAt))));
      add("terminal", "מסוף", terminal, chargeback.terminalNumber, payment.terminalNumber, Boolean(normalizedId(chargeback.terminalNumber) && normalizedId(payment.terminalNumber)));
      add("session", "סשן", session, chargeback.sessionNumber, payment.sessionNumber, Boolean(normalizedId(chargeback.sessionNumber) && normalizedId(payment.sessionNumber)));
      const reasons = [provider && "מזהה עסקה זהה", confirmation && "מספר אישור זהה", voucher && "מספר שובר זהה", card && "4 ספרות אחרונות זהות", amountMatch && "סכום זהה", sameDay && "יום עסקה זהה", time && `מועד עסקה ${displayTime(distance)}`].filter((value): value is string => Boolean(value));
      // A chargeback candidate must refer to the same card and the same
      // charged amount. Amount and date alone create many false positives,
      // while a missing Shopify card suffix is not evidence of a match.
      const cardAndAmount = card && amountMatch;
      const exact = (provider && amountMatch) || (cardAndAmount && (confirmation || voucher)) || (amountMatch && preciseTime && !cardConflict);
      const strong = cardAndAmount && (confirmation || voucher || distance <= 86_400_000 || score >= 65);
      const possible = cardAndAmount && time;
      return { order, score: Math.min(score, 100), comparisons, reasons, exact, strong, possible, amountMatch, sameDay, cardConflict };
    }).sort((left, right) => right.score - left.score)[0];
  }).sort((left, right) => right.score - left.score);

  const best = candidates[0];
  if (!best) return { confidence: "unmatched", score: 0, reasons: [], comparisons: [] };
  const amountDayCandidates = [...new Map(candidates
    .filter((candidate) => candidate.amountMatch && candidate.sameDay && !candidate.cardConflict)
    .map((candidate) => [candidate.order.shopifyOrderId, candidate.order]))
    .values()];
  const exactAlternative = best.exact && candidates.slice(1).some((candidate) => candidate.exact);
  const closeAlternative = candidates[1] && best.score - candidates[1].score < 10;
  // When CrediMatch has only a calendar day (often shown as 00:00), a unique
  // amount + day candidate is useful for review, but never becomes a strong or exact match.
  const uniqueAmountDay = amountDayCandidates.length === 1;
  const ambiguousAmountDay = !best.exact && !best.strong && !best.possible && amountDayCandidates.length > 1;
  if (ambiguousAmountDay) {
    return {
      confidence: "ambiguous", score: best.score,
      reasons: [`נמצאו ${amountDayCandidates.length} עסקאות באותו סכום ובאותו יום`],
      comparisons: [],
      candidates: amountDayCandidates.map((order) => ({
        orderId: order.shopifyOrderId, orderNumber: order.orderNumber, storeId: order.storeId,
        storeName: order.storeName, customer: order.customer, email: order.email,
        amount: order.amount, currency: order.currency, createdAt: order.createdAt,
      })),
    };
  }
  if (!best.exact && !best.strong && !best.possible && !uniqueAmountDay) return { confidence: "unmatched", score: 0, reasons: [], comparisons: [] };
  const confidence = uniqueAmountDay || (best.exact && !exactAlternative)
    ? "exact"
    : best.strong && !closeAlternative
      ? "strong"
      : best.possible
        ? "possible"
        : "unmatched";
  return {
    confidence, score: best.score, orderId: best.order.shopifyOrderId, orderNumber: best.order.orderNumber,
    storeId: best.order.storeId, storeName: best.order.storeName, customer: best.order.customer, email: best.order.email,
    amount: best.order.amount, currency: best.order.currency, createdAt: best.order.createdAt,
    reasons: uniqueAmountDay ? [...best.reasons, "סכום ויום ייחודיים"] : best.reasons, comparisons: best.comparisons,
  };
}
