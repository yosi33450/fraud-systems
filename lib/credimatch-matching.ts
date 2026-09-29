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
const normalizedId = (value: unknown) => text(value)?.replace(/[^a-z0-9]/gi, "").toLowerCase();
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
  transactions: Array<{ id?: string; gateway?: string; formatted_gateway?: string; account_number?: string; amount?: string | number; processed_at?: string; receipt?: unknown }>,
  fallbackCurrency?: string,
): OrderPaymentFingerprint[] {
  return transactions.map((transaction) => ({
    transactionId: text(transaction.id),
    gateway: text(transaction.formatted_gateway ?? transaction.gateway),
    amount: number(transaction.amount),
    currency: normalizedCurrency(receiptValue(transaction.receipt, ["currency", "currencyCode"])) ?? normalizedCurrency(fallbackCurrency),
    processedAt: text(transaction.processed_at),
    last4: last4(transaction.account_number ?? receiptValue(transaction.receipt, ["last4", "lastFour", "last_four", "creditCardSuffix", "cardSuffix"])),
    confirmationNumber: text(receiptValue(transaction.receipt, ["confirmationNumber", "authorization", "authorizationCode", "authCode", "approvalCode"])),
    voucherNumber: text(receiptValue(transaction.receipt, ["voucherNumber", "voucher", "shovar"])),
    terminalNumber: text(receiptValue(transaction.receipt, ["terminalNumber", "terminalId", "terminal"])),
    sessionNumber: text(receiptValue(transaction.receipt, ["sessionNumber", "sessionId", "session"])),
  })).filter((payment) => Object.values(payment).some(Boolean));
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
      receivedAt: input.receivedAt ?? new Date().toISOString(),
      dealTime: text(item.dealTime) ?? text(transaction?.transactionDate), creationTime: text(item.creationTime), originalAmount: number(item.originalAmount), payments: number(item.payments) ?? number(transaction?.numberOfPayments),
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
const displayTime = (distance: number) => distance <= 15 * 60_000 ? "עד 15 דקות" : distance <= 86_400_000 ? "באותו יום" : "עד 3 ימים";

export function matchCrediMatchChargeback(chargeback: CrediMatchChargeback, orders: MatchableShopifyOrder[]): ChargebackOrderMatch {
  const candidates = orders.map((order) => {
    const paymentOptions = order.payments?.length ? order.payments : [{}];
    return paymentOptions.map((payment) => {
      const comparisons: ChargebackMatchComparison[] = [];
      let score = 0;
      const amount = chargeback.originalAmount ?? chargeback.grossAmount;
      const paymentAmount = payment.amount ?? order.amount;
      const confirmation = sameNumber(chargeback.confirmationNumber, payment.confirmationNumber);
      const voucher = sameNumber(chargeback.voucherNumber, payment.voucherNumber);
      const card = Boolean(chargeback.last4Digits && payment.last4 && chargeback.last4Digits === payment.last4);
      const amountMatch = sameMoney(amount, paymentAmount);
      const currency = Boolean(chargeback.currency && (payment.currency ?? order.currency) && chargeback.currency === (payment.currency ?? order.currency)?.toUpperCase());
      const terminal = sameNumber(chargeback.terminalNumber, payment.terminalNumber);
      const session = sameNumber(chargeback.sessionNumber, payment.sessionNumber);
      const distance = timeDistance(chargeback.dealTime, payment.processedAt ?? order.createdAt);
      const time = distance <= 3 * 86_400_000;
      if (confirmation) score += 80;
      if (voucher) score += 75;
      if (card) score += 25;
      if (amountMatch) score += 25;
      if (currency) score += 5;
      if (terminal) score += 8;
      if (session) score += 20;
      if (distance <= 15 * 60_000) score += 20; else if (distance <= 86_400_000) score += 12; else if (time) score += 5;
      const add = (key: ChargebackMatchComparison["key"], label: string, matched: boolean, crediMatchValue?: string, shopifyValue?: string) => {
        if (crediMatchValue || shopifyValue) comparisons.push({ key, label, matched, crediMatchValue, shopifyValue });
      };
      add("confirmation", "מספר אישור", confirmation, chargeback.confirmationNumber, payment.confirmationNumber);
      add("voucher", "מספר שובר", voucher, chargeback.voucherNumber, payment.voucherNumber);
      add("last4", "4 ספרות אחרונות", card, chargeback.last4Digits ? `•••• ${chargeback.last4Digits}` : undefined, payment.last4 ? `•••• ${payment.last4}` : undefined);
      add("amount", "סכום", amountMatch, amount?.toFixed(2), paymentAmount?.toFixed(2));
      add("currency", "מטבע", currency, chargeback.currency, payment.currency ?? order.currency);
      add("time", "מועד העסקה", time, chargeback.dealTime, payment.processedAt ?? order.createdAt);
      add("terminal", "מסוף", terminal, chargeback.terminalNumber, payment.terminalNumber);
      add("session", "סשן", session, chargeback.sessionNumber, payment.sessionNumber);
      const reasons = [confirmation && "מספר אישור זהה", voucher && "מספר שובר זהה", card && "4 ספרות אחרונות זהות", amountMatch && "סכום זהה", time && `מועד עסקה ${displayTime(distance)}`].filter((value): value is string => Boolean(value));
      const exact = (confirmation || voucher) && amountMatch;
      const strong = confirmation || voucher || (card && amountMatch && distance <= 86_400_000) || score >= 65;
      const possible = amountMatch && time;
      return { order, score: Math.min(score, 100), comparisons, reasons, exact, strong, possible };
    }).sort((left, right) => right.score - left.score)[0];
  }).sort((left, right) => right.score - left.score);

  const best = candidates[0];
  if (!best || (!best.exact && !best.strong && !best.possible)) return { confidence: "unmatched", score: 0, reasons: [], comparisons: [] };
  const closeAlternative = candidates[1] && best.score - candidates[1].score < 10;
  const confidence = best.exact && !closeAlternative ? "exact" : best.strong && !closeAlternative ? "strong" : "possible";
  return {
    confidence, score: best.score, orderId: best.order.shopifyOrderId, orderNumber: best.order.orderNumber,
    storeId: best.order.storeId, storeName: best.order.storeName, customer: best.order.customer, email: best.order.email,
    amount: best.order.amount, currency: best.order.currency, createdAt: best.order.createdAt,
    reasons: best.reasons, comparisons: best.comparisons,
  };
}
