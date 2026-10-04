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
// `more_info` is the merchant's opaque PayPlus reference. Unlike an approval
// number, it can contain letters and leading zeroes, so normalize punctuation
// and casing only — never coerce it into a number.
const normalizedMerchantReference = (value: unknown) =>
  text(value)?.replace(/[^a-z0-9]/gi, "").toLowerCase() || undefined;
const sameMerchantReference = (left?: string, right?: string) =>
  Boolean(left && right && normalizedMerchantReference(left) === normalizedMerchantReference(right));
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
    // Shopify presents PayPlus' value as "Payment ID" on the order's payment
    // details.  PayPlus returns that exact opaque value as `more_info`.
    // It is the only Shopify value eligible for an automatic chargeback link.
    merchantReference: text(transaction.payment_id)
      ?? text(receiptValue(transaction.receipt, ["more_info", "moreInfo", "merchantReference", "merchant_reference", "reference"])),
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
  const merchantReference = chargeback.payplus?.merchantReference;
  if (!merchantReference) return { confidence: "unmatched", score: 0, reasons: [], comparisons: [] };

  const matches = orders.flatMap((order) => (order.payments ?? [])
    .filter((payment) => sameMerchantReference(merchantReference, payment.merchantReference))
    .map((payment) => ({ order, payment })));
  const uniqueOrders = [...new Map(matches.map((match) => [match.order.shopifyOrderId, match])).values()];
  if (uniqueOrders.length === 0) return { confidence: "unmatched", score: 0, reasons: [], comparisons: [] };
  if (uniqueOrders.length > 1) {
    return {
      confidence: "ambiguous", score: 100,
      reasons: [`אסמכתת PayPlus נמצאה ב־${uniqueOrders.length} הזמנות`], comparisons: [],
      candidates: uniqueOrders.map(({ order }) => ({
        orderId: order.shopifyOrderId, orderNumber: order.orderNumber, storeId: order.storeId,
        storeName: order.storeName, customer: order.customer, email: order.email,
        amount: order.amount, currency: order.currency, createdAt: order.createdAt,
      })),
    };
  }

  const { order, payment } = uniqueOrders[0];
  return {
    confidence: "exact", score: 100, orderId: order.shopifyOrderId, orderNumber: order.orderNumber,
    storeId: order.storeId, storeName: order.storeName, customer: order.customer, email: order.email,
    amount: order.amount, currency: order.currency, createdAt: order.createdAt,
    reasons: ["אסמכתת PayPlus זהה"],
    comparisons: [{
      key: "reference", label: "אסמכתת PayPlus (more_info)", matched: true, compared: true,
      crediMatchValue: merchantReference, shopifyValue: payment.merchantReference,
    }],
  };
}
