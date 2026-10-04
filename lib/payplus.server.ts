import type { CrediMatchChargeback, PayPlusPaymentEvidence } from "@/lib/types";

const endpoint = "https://restapi.payplus.co.il/api/v1.0/PaymentPages/ipn-full";
type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim() || undefined : undefined;
const numeric = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};
const last4 = (value: unknown) => text(value)?.replace(/\D/g, "").slice(-4) || undefined;
const currency = (value: unknown) => {
  const candidate = text(value)?.toUpperCase();
  if (!candidate) return undefined;
  if (/ILS|NIS|שקל/.test(candidate)) return "ILS";
  return /^[A-Z]{3}$/.test(candidate) ? candidate : undefined;
};
const valueAt = (source: UnknownRecord | undefined, paths: string[]) => {
  for (const path of paths) {
    let value: unknown = source;
    for (const segment of path.split(".")) value = record(value)?.[segment];
    const result = text(value);
    if (result) return result;
  }
  return undefined;
};
const numberAt = (source: UnknownRecord | undefined, paths: string[]) => {
  for (const path of paths) {
    let value: unknown = source;
    for (const segment of path.split(".")) value = record(value)?.[segment];
    const result = numeric(value);
    if (result !== undefined) return result;
  }
  return undefined;
};
const dateAt = (source: UnknownRecord | undefined, paths: string[]) => {
  const candidate = valueAt(source, paths);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : undefined;
};

const sensitiveField = /(cvv|cvc|card.*(?:number|num)|(?:token|secret|api.?key|password|signature)|authorization)/i;
const sensitiveValue = (value: string) => /\b\d[\d -]{10,}\d\b/.test(value);
function safeDetails(value: unknown, prefix = "", depth = 0, result: Record<string, string> = {}) {
  if (depth > 4 || Object.keys(result).length >= 80) return result;
  if (Array.isArray(value)) {
    value.slice(0, 12).forEach((entry, index) => safeDetails(entry, `${prefix}[${index}]`, depth + 1, result));
    return result;
  }
  const source = record(value);
  if (source) {
    for (const [key, entry] of Object.entries(source)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!sensitiveField.test(path)) safeDetails(entry, path, depth + 1, result);
    }
    return result;
  }
  const scalar = text(value);
  if (scalar && prefix && scalar.length <= 360 && !sensitiveValue(scalar)) result[prefix] = scalar;
  return result;
}

function responseData(payload: unknown): UnknownRecord | undefined {
  const root = record(payload);
  const data = record(root?.data);
  return data ?? root;
}

function normalizePayload(approvalNumber: string, payload: unknown): Omit<PayPlusPaymentEvidence, "status" | "checkedAt"> {
  const data = responseData(payload);
  return {
    approvalNumber: valueAt(data, ["approval_num", "approval_number", "approvalNumber"]) ?? approvalNumber,
    transactionUid: valueAt(data, ["transaction_uid", "transactionUid", "transaction.uid"]),
    paymentRequestUid: valueAt(data, ["payment_request_uid", "paymentRequestUid", "page_request_uid", "pageRequestUid"]),
    voucherNumber: valueAt(data, ["voucher_num", "voucher_number", "voucherNumber"]),
    amount: numberAt(data, ["amount", "total_amount", "total", "transaction.amount"]),
    currency: currency(valueAt(data, ["currency", "currency_code", "transaction.currency"])),
    paidAt: dateAt(data, ["transaction_date", "transactionDate", "created_at", "createdAt", "transaction.date"]),
    paymentStatus: valueAt(data, ["status", "transaction.status", "payment_status"]),
    cardLast4: last4(valueAt(data, ["card_information.four_digits", "card_information.last4", "card_last4", "last4"])),
    terminalNumber: valueAt(data, ["terminal_number", "terminalNumber", "terminal.num"]),
    customerName: valueAt(data, ["customer_name", "customer.name", "customer.full_name"]),
    email: valueAt(data, ["customer.email", "email", "customer_email"]),
    phone: valueAt(data, ["customer.phone", "phone", "customer_phone"]),
    merchantReference: valueAt(data, ["more_info", "more_info_1", "moreInfo", "merchant_reference", "reference"]),
    details: safeDetails(data),
  };
}

function configuration() {
  const apiKey = process.env.PAYPLUS_API_KEY;
  const secretKey = process.env.PAYPLUS_SECRET_KEY;
  return apiKey && secretKey ? { apiKey, secretKey } : null;
}

export function payPlusConfigured() {
  return Boolean(configuration());
}

export async function lookUpPayPlusPayment(chargeback: CrediMatchChargeback): Promise<PayPlusPaymentEvidence> {
  const approvalNumber = chargeback.confirmationNumber?.trim();
  if (!approvalNumber || approvalNumber.length > 80) {
    return { status: "not-found", checkedAt: new Date().toISOString(), approvalNumber: approvalNumber ?? "", message: "לא התקבל מספר אישור" };
  }
  const config = configuration();
  if (!config) throw new Error("PAYPLUS_NOT_CONFIGURED");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": config.apiKey,
        "secret-key": config.secretKey,
      },
      body: JSON.stringify({ approval_num: approvalNumber, related_transaction: true }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`PAYPLUS_LOOKUP_FAILED_${response.status}`);
    const payload = await response.json() as unknown;
    const result = record(payload);
    const resultStatus = text(record(result?.results)?.status)?.toLowerCase();
    if (resultStatus && !["success", "ok", "succeeded"].includes(resultStatus)) {
      return { status: "not-found", checkedAt: new Date().toISOString(), approvalNumber, message: "PayPlus לא החזירה עסקה תואמת" };
    }
    const evidence = normalizePayload(approvalNumber, payload);
    // The approval number is the authoritative bridge from CrediMatch to
    // PayPlus. Amounts and dates are descriptive fields only: they must not
    // block the retrieval of `more_info`, which is the actual Shopify key.
    return { ...evidence, status: "found", checkedAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof Error && error.message === "PAYPLUS_NOT_CONFIGURED") throw error;
    return { status: "error", checkedAt: new Date().toISOString(), approvalNumber, message: "לא ניתן היה לקבל פרטים מ־PayPlus כרגע" };
  } finally {
    clearTimeout(timeout);
  }
}

export function enrichChargebackFromPayPlus(chargeback: CrediMatchChargeback, payplus: PayPlusPaymentEvidence): CrediMatchChargeback {
  if (payplus.status !== "found") return { ...chargeback, payplus };
  return {
    ...chargeback,
    providerUid: chargeback.providerUid ?? payplus.transactionUid ?? payplus.paymentRequestUid,
    voucherNumber: chargeback.voucherNumber ?? payplus.voucherNumber,
    terminalNumber: chargeback.terminalNumber ?? payplus.terminalNumber,
    last4Digits: chargeback.last4Digits ?? payplus.cardLast4,
    currency: chargeback.currency ?? payplus.currency,
    dealTime: chargeback.dealTime ?? payplus.paidAt,
    dealTimePrecise: chargeback.dealTimePrecise ?? Boolean(payplus.paidAt),
    payplus,
  };
}
