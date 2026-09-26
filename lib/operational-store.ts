import { createHmac, randomUUID } from "node:crypto";
import { cases as seedCases, employees as seedEmployees, rules as seedRules, stores as seedStores } from "@/lib/initial-state";
import { evaluateRisk, type OrderSignals } from "@/lib/risk-engine";
import { computeVelocitySignals, createVelocityLookup } from "@/lib/order-velocity";
import { isSharedServiceEmail } from "@/lib/customer-identity";
import { buildGiftLedger, hasFlaggedGiftSource, receiptGiftCard, type GiftCardOrderEvidence } from "@/lib/gift-card-evidence";
import type { BlacklistReport, CaseStatus, DashboardSnapshot, Employee, EmployeeMonitoringSettings, FraudCase, GiftCardRedemption, GiftCardTrace, NotificationDelivery, NotificationSettings, RiskRule, Store } from "@/lib/types";

type ShopifyLineItem = {
  title?: string;
  name?: string;
  quantity?: number;
  price?: string | number;
  gift_card?: boolean;
  product_type?: string;
};

export type ShopifyOrderTransaction = {
  id?: string;
  gateway?: string;
  formatted_gateway?: string;
  account_number?: string;
  amount?: string | number;
  status?: string;
  kind?: string;
  processed_at?: string;
  receipt?: unknown;
};

export type ShopifyOrderPayload = {
  id?: string | number;
  admin_graphql_api_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  total_price?: string | number;
  currency?: string;
  created_at?: string;
  customer?: { id?: string | number; admin_graphql_api_id?: string; first_name?: string; last_name?: string; email?: string; phone?: string };
  billing_address?: { first_name?: string; last_name?: string; address1?: string; city?: string; zip?: string; phone?: string };
  shipping_address?: { first_name?: string; last_name?: string; address1?: string; city?: string; zip?: string; phone?: string };
  line_items?: ShopifyLineItem[];
  risk_level?: "none" | "low" | "medium" | "high";
  payment_failures?: number;
  refund_after_fulfillment?: boolean;
  browser_ip?: string;
  client_ip?: string;
  gateway_names?: string[];
  shopify_risk_facts?: string[];
  tags?: string | string[];
  discount_codes?: string[];
  transactions?: ShopifyOrderTransaction[];
};

type StoredOrder = {
  tenantId: string;
  storeId: string;
  shopifyOrderId: string;
  email: string;
  phone: string;
  address: string;
  amount: number;
  giftCardValue: number;
  ip: string;
  customerId: string;
  couponCodes?: string[];
  createdAt: string;
};

export type GiftCardRegistryInput = {
  giftCardId: string;
  maskedCode: string;
  lastCharacters: string;
  initialValue: number;
  balance: number;
  purchaseOrderId?: string;
  purchaseOrderNumber?: string;
};

type StoredGiftCard = GiftCardRegistryInput & {
  tenantId: string;
  storeId: string;
  purchaserCustomer?: string;
  purchaserEmail?: string;
  purchaserCustomerId?: string;
  redemptions: GiftCardRedemption[];
};

type AuditEntry = {
  id: string;
  tenantId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

type OperationalState = {
  cases: FraudCase[];
  stores: Store[];
  employees: Employee[];
  employeeSettingsByTenant: Map<string, EmployeeMonitoringSettings>;
  rulesByTenant: Map<string, RiskRule[]>;
  notificationsByTenant: Map<string, NotificationSettings>;
  deliveries: NotificationDelivery[];
  reports: BlacklistReport[];
  reportDigests: Map<string, string>;
  globalDigests: Set<string>;
  webhookIds: Set<string>;
  orders: StoredOrder[];
  giftCards: StoredGiftCard[];
  giftCardOrders: GiftCardOrderEvidence[];
  audit: AuditEntry[];
  storeConnections: Map<string, { accessToken: string; expiresAt: string; webhookSecret?: string }>;
};

export type PersistedOperationalState = {
  version: 1;
  cases: FraudCase[];
  stores: Store[];
  employees: Employee[];
  employeeSettingsByTenant?: Array<[string, EmployeeMonitoringSettings]>;
  rulesByTenant: Array<[string, RiskRule[]]>;
  notificationsByTenant: Array<[string, NotificationSettings]>;
  deliveries: NotificationDelivery[];
  reports: BlacklistReport[];
  reportDigests: Array<[string, string]>;
  globalDigests: string[];
  webhookIds: string[];
  orders: StoredOrder[];
  giftCards?: StoredGiftCard[];
  giftCardOrders?: GiftCardOrderEvidence[];
  audit: AuditEntry[];
  storeConnections: Array<[string, { accessToken: string; expiresAt: string; webhookSecret?: string }]>;
};

const clone = <T,>(value: T): T => structuredClone(value);

const createInitialState = (): OperationalState => ({
  cases: clone(seedCases),
  stores: clone(seedStores),
  employees: clone(seedEmployees),
  employeeSettingsByTenant: new Map(),
  rulesByTenant: new Map([["tenant-primary", clone(seedRules)]]),
  notificationsByTenant: new Map(),
  deliveries: [],
  reports: [],
  reportDigests: new Map(),
  globalDigests: new Set<string>(),
  webhookIds: new Set<string>(),
  orders: [],
  giftCards: [],
  giftCardOrders: [],
  audit: [],
  storeConnections: new Map(),
});

declare global {
  // eslint-disable-next-line no-var
  var __shieldLedgerState: OperationalState | undefined;
}

const state = globalThis.__shieldLedgerState ?? createInitialState();
globalThis.__shieldLedgerState = state;

export function exportOperationalState(): PersistedOperationalState {
  return clone({
    version: 1,
    cases: state.cases,
    stores: state.stores,
    employees: state.employees,
    employeeSettingsByTenant: [...state.employeeSettingsByTenant.entries()],
    rulesByTenant: [...state.rulesByTenant.entries()],
    notificationsByTenant: [...state.notificationsByTenant.entries()],
    deliveries: state.deliveries,
    reports: state.reports,
    reportDigests: [...state.reportDigests.entries()],
    globalDigests: [...state.globalDigests],
    webhookIds: [...state.webhookIds],
    orders: state.orders,
    giftCards: state.giftCards,
    giftCardOrders: state.giftCardOrders ?? [],
    audit: state.audit,
    storeConnections: [...state.storeConnections.entries()],
  });
}

export function restoreOperationalState(snapshot: PersistedOperationalState) {
  if (snapshot.version !== 1) throw new Error("UNSUPPORTED_STATE_VERSION");
  state.cases = clone(snapshot.cases ?? []);
  state.stores = clone(snapshot.stores ?? []);
  state.employees = clone(snapshot.employees ?? []);
  state.employeeSettingsByTenant = new Map(clone(snapshot.employeeSettingsByTenant ?? []));
  state.rulesByTenant = new Map(clone(snapshot.rulesByTenant ?? []));
  state.notificationsByTenant = new Map(clone(snapshot.notificationsByTenant ?? []));
  state.deliveries = clone(snapshot.deliveries ?? []);
  state.reports = clone(snapshot.reports ?? []);
  state.reportDigests = new Map(clone(snapshot.reportDigests ?? []));
  state.globalDigests = new Set(clone(snapshot.globalDigests ?? []));
  state.webhookIds = new Set(clone(snapshot.webhookIds ?? []));
  state.orders = clone(snapshot.orders ?? []);
  state.giftCards = clone(snapshot.giftCards ?? []);
  state.giftCardOrders = clone(snapshot.giftCardOrders ?? []);
  state.audit = clone(snapshot.audit ?? []);
  state.storeConnections = new Map(clone(snapshot.storeConnections ?? []));
  state.stores = state.stores.map((store) => ({
    ...store,
    realtimeStatus: store.realtimeStatus ?? "setup-required",
  }));
  migrateLegacyRules();
}

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const normalizePhone = (value: string) => value.replace(/\D/g, "");
const normalizeAddress = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const hmacKey = () => process.env.BLACKLIST_HMAC_KEY ?? "development-only-blacklist-key-change-me";
type IdentityKind = BlacklistReport["keyType"];
const digest = (type: IdentityKind, value: string) => createHmac("sha256", hmacKey()).update(`${type}:${value}`).digest("hex");
const digestKey = (type: IdentityKind, value: string) => `${type}:${digest(type, value)}`;

const maskEmail = (email: string) => {
  const [, domain = "unknown"] = email.split("@");
  return `••••@${domain}`;
};

const maskIdentity = (type: IdentityKind, value: string) => {
  if (type === "email") return maskEmail(value);
  if (type === "phone") return value.length > 4 ? `••••••${value.slice(-4)}` : "••••";
  if (type === "ip") {
    if (value.includes(":")) return `${value.split(":").slice(0, 2).join(":")}:…`;
    const parts = value.split(".");
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.×.×` : "IP מוסתר";
  }
  if (type === "customer") return `Shopify · ${value.split("/").at(-1) ?? "לקוח"}`;
  return value.length > 12 ? `${value.slice(0, 10)}…` : value;
};

const tenantStore = (tenantId: string, storeId: string) => {
  const store = state.stores.find((item) => item.tenantId === tenantId && item.id === storeId);
  if (!store) throw new Error("STORE_NOT_FOUND");
  return store;
};

const baselineRules = (): RiskRule[] => [
  {
    id: "recommended-orders-hour", label: "ריבוי הזמנות · שעה", description: "יותר מ־3 הזמנות באותו אימייל, IP או טלפון בחלון מתגלגל של שעה. אפשר להסיר או להוסיף מזהים בעריכת התנאים.",
    category: "velocity", enabled: true, logic: "any", recommended: true, matches: 0,
    conditions: (["email", "ip", "phone"] as const).map((identity) => ({ id: `orders-hour-${identity}`, field: `orders_by_${identity}` as const, operator: "gt", value: 3, windowMinutes: 60 })),
    action: { severity: "high", openCase: true, emailOwner: true },
  },
  {
    id: "recommended-orders-day", label: "ריבוי הזמנות · יום", description: "יותר מ־5 הזמנות באותו אימייל, IP או טלפון ב־24 שעות. אפשר לבחור את המזהים בעריכת התנאים.",
    category: "velocity", enabled: true, logic: "any", recommended: true, matches: 0,
    conditions: (["email", "ip", "phone"] as const).map((identity) => ({ id: `orders-day-${identity}`, field: `orders_by_${identity}` as const, operator: "gt", value: 5, windowMinutes: 1440 })),
    action: { severity: "high", openCase: true, emailOwner: true },
  },
  {
    id: "recommended-night-orders", label: "רכישה בשעות הלילה", description: "אות משלים בלבד: מוסיף מעט נקודות להזמנה בין 00:00 ל־05:00 לפי שעון ישראל, בלי לפתוח תיק בפני עצמו.",
    category: "payment", enabled: true, logic: "all", recommended: true, matches: 0,
    conditions: [{ id: "night-hours", field: "order_local_hour", operator: "eq", value: true, startHour: 0, endHour: 5 }],
    action: { severity: "low", openCase: false, emailOwner: false, scoreBonus: 5 },
  },
  {
    id: "recommended-phone-hourly-velocity", label: "ריבוי הזמנות מאותו טלפון בשעה", description: "יותר מ־3 הזמנות מאותו טלפון בתוך שעה.",
    category: "velocity", enabled: false, logic: "all", recommended: true, matches: 0,
    conditions: [{ id: "phone-hourly", field: "orders_by_phone", operator: "gt", value: 3, windowMinutes: 60 }],
    action: { severity: "high", openCase: true, emailOwner: true },
  },
  {
    id: "recommended-phone-daily-velocity", label: "ריבוי הזמנות מאותו טלפון ביום", description: "יותר מ־5 הזמנות מאותו טלפון בתוך 24 שעות.",
    category: "velocity", enabled: false, logic: "all", recommended: true, matches: 0,
    conditions: [{ id: "phone-daily", field: "orders_by_phone", operator: "gt", value: 5, windowMinutes: 1440 }],
    action: { severity: "high", openCase: true, emailOwner: true },
  },
  {
    id: "recommended-gift-card-repeat-100", label: "ריבוי רכישות Gift Card מעל ₪100", description: "3 רכישות Gift Card או יותר מעל ₪100 לרכישה בתוך שעתיים, לפי IP, אימייל או טלפון.",
    category: "gift-card", enabled: true, logic: "any", recommended: true, matches: 0,
    conditions: [
      { id: "gift-repeat-ip", field: "gift_card_orders_by_ip", operator: "gte", value: 3, windowMinutes: 120, minGiftCardValue: 100 },
      { id: "gift-repeat-email", field: "gift_card_orders_by_email", operator: "gte", value: 3, windowMinutes: 120, minGiftCardValue: 100 },
      { id: "gift-repeat-phone", field: "gift_card_orders_by_phone", operator: "gte", value: 3, windowMinutes: 120, minGiftCardValue: 100 },
    ],
    action: { severity: "critical", openCase: true, emailOwner: true },
  },
  {
    id: "recommended-gift-card-amount", label: "סכום Gift Card חריג בהזמנה", description: "התראה אם שווי Gift Cards בהזמנה בודדת גבוה מהסף שהוגדר.",
    category: "gift-card", enabled: true, logic: "all", recommended: true, matches: 0,
    conditions: [{ id: "gift-amount", field: "gift_card_value", operator: "gt", value: 1500 }],
    action: { severity: "high", openCase: true, emailOwner: true },
  },
  {
    id: "recommended-ip-velocity", label: "ריבוי הזמנות מאותה כתובת IP בשעה", description: "יותר מ־3 רכישות באותה חנות ובאותו IP ב־60 דקות מתגלגלות. IP אינו הוכחת זהות.",
    category: "velocity", enabled: false, logic: "all", recommended: true, matches: 0,
    conditions: [{ id: "ip-velocity", field: "orders_by_ip", operator: "gt", value: 3, windowMinutes: 60 }],
    action: { severity: "high", openCase: true, emailOwner: true },
  },
  {
    id: "recommended-gift-card-ip-velocity", label: "ריבוי רכישות Gift Card מאותו IP", description: "פותח התראה קריטית כאשר מאותו IP נוצרות 3 הזמנות Gift Card או יותר בתוך שעתיים, גם אם האימייל משתנה.",
    category: "gift-card", enabled: false, logic: "all", recommended: true, matches: 0,
    conditions: [{ id: "gift-card-ip-velocity", field: "gift_card_orders_by_ip", operator: "gte", value: 3, windowMinutes: 120 }],
    action: { severity: "critical", openCase: true, emailOwner: true },
  },
  {
    id: "recommended-gift-card-ip-identities", label: "Gift Card עם כמה אימיילים מאותו IP", description: "פותח התראה כאשר רכישת Gift Card מגיעה מ-IP ששימש לפחות 2 אימיילים שונים בתוך שעתיים.",
    category: "gift-card", enabled: true, logic: "all", recommended: true, matches: 0,
    conditions: [
      { id: "gift-card-present", field: "gift_card_value", operator: "gt", value: 0 },
      { id: "gift-card-ip-emails", field: "emails_by_ip", operator: "gte", value: 2, windowMinutes: 120 },
    ],
    action: { severity: "high", openCase: true, emailOwner: true },
  },
  {
    id: "recommended-linked-gift-card", label: "מימוש Gift Card שנרכש בתיק חשוד", description: "מקשר בין ההזמנה שבה הונפק הכרטיס להזמנה שבה מומש, ופותח תיק כאשר זהות המממש שונה מזהות הרוכש.",
    category: "gift-card", enabled: true, logic: "all", recommended: true, matches: 0,
    conditions: [{ id: "linked-gift-card", field: "linked_gift_card", operator: "eq", value: true }],
    action: { severity: "critical", openCase: true, emailOwner: true },
  },
  {
    id: "recommended-email-velocity", label: "ריבוי הזמנות מאותו אימייל", description: "פותח התראה כאשר אותו אימייל מבצע 4 הזמנות או יותר בתוך שעה.",
    category: "velocity", enabled: false, logic: "all", recommended: true, matches: 0,
    conditions: [{ id: "email-velocity", field: "orders_by_email", operator: "gt", value: 3, windowMinutes: 60 }],
    action: { severity: "high", openCase: true, emailOwner: true },
  },
  ...(["email", "ip"] as const).map((identity): RiskRule => ({
    id: `recommended-${identity}-daily-velocity`, label: `ריבוי הזמנות מאותו ${identity === "email" ? "אימייל" : "IP"} ביום`,
    description: "יותר מ־5 רכישות באותה חנות ב־24 שעות מתגלגלות, כולל הרכישה הנוכחית.",
    category: "velocity", enabled: false, logic: "all", recommended: true, matches: 0,
    conditions: [{ id: `${identity}-daily-velocity`, field: identity === "email" ? "orders_by_email" : "orders_by_ip", operator: "gt", value: 5, windowMinutes: 1440 }],
    action: { severity: "high", openCase: true, emailOwner: true },
  })),
  {
    id: "recommended-phone-identities", label: "מספר טלפון עם כמה זהויות", description: "פותח התראה כאשר מספר טלפון משויך ל־3 אימיילים או יותר ב־24 שעות.",
    category: "identity", enabled: true, logic: "all", recommended: true, matches: 0,
    conditions: [{ id: "phone-identities", field: "identities_by_phone", operator: "gte", value: 3, windowMinutes: 1440 }],
    action: { severity: "high", openCase: true, emailOwner: true },
  },
  {
    id: "recommended-order-spike", label: "סכום הזמנה חריג", description: "פותח התראה על רכישה בודדת מעל 1,500 ₪, לא על סכום מצטבר של קבוצה.",
    category: "payment", enabled: true, logic: "all", recommended: true, matches: 0,
    conditions: [{ id: "order-spike", field: "order_amount", operator: "gt", value: 1500 }],
    action: { severity: "medium", openCase: true, emailOwner: false },
  },
  {
    id: "recommended-order-high", label: "סכום הזמנה חריג מאוד", description: "מעלה את ההתראה לגבוהה כאשר סכום ההזמנה גבוה מ־₪5,000.",
    category: "payment", enabled: true, logic: "all", recommended: true, matches: 0,
    conditions: [{ id: "order-high", field: "order_amount", operator: "gt", value: 5000 }],
    action: { severity: "high", openCase: true, emailOwner: true },
  },
  {
    id: "recommended-order-critical", label: "סכום הזמנה קיצוני", description: "מעלה את ההתראה לקריטית כאשר סכום ההזמנה גבוה מ־₪15,000.",
    category: "payment", enabled: true, logic: "all", recommended: true, matches: 0,
    conditions: [{ id: "order-critical", field: "order_amount", operator: "gt", value: 15000 }],
    action: { severity: "critical", openCase: true, emailOwner: true },
  },
  {
    id: "recommended-gift-card", label: "גיפט קארד עם כשלי תשלום", description: "פותח התראה קריטית על רכישת גיפט קארד בסכום גבוה לאחר כמה כשלי תשלום.",
    category: "gift-card", enabled: true, logic: "all", recommended: true, matches: 0,
    conditions: [
      { id: "gift-card-value", field: "gift_card_value", operator: "gte", value: 1500, windowMinutes: 120 },
      { id: "gift-card-failures", field: "payment_failures", operator: "gte", value: 2 },
    ],
    action: { severity: "critical", openCase: true, emailOwner: true },
  },
  {
    id: "protected-network-match", label: "התאמה למאגר ההונאות המשותף", description: "אחד ממזהי הלקוח נמצא במאגר המשותף בצורה מוצפנת.",
    category: "network", enabled: true, logic: "all", locked: true, matches: 0,
    conditions: [{ id: "network-match", field: "network_match", operator: "eq", value: true }],
    action: { severity: "critical", openCase: true, emailOwner: true },
  },
];

const migrateLegacyRules = () => {
  for (const rules of state.rulesByTenant.values()) {
    const legacy = rules.find((rule) => rule.id === "recommended-order-spike");
    const condition = legacy?.conditions[0];
    if (legacy && legacy.conditions.length === 1 && condition?.field === "order_amount_vs_average") {
      const threshold = typeof condition.value === "number" && condition.value >= 100 ? condition.value : 1000;
      legacy.label = "סכום הזמנה חריג";
      legacy.description = `פותח התראה כאשר סכום ההזמנה גבוה מ־₪${threshold.toLocaleString("he-IL")}.`;
      legacy.conditions = [{ id: condition.id, field: "order_amount", operator: "gt", value: threshold }];
    }

    const introducingGroupedVelocity = !rules.some((rule) => rule.id === "recommended-orders-hour");
    const requiredRules = baselineRules().filter((rule) => ["recommended-order-high", "recommended-order-critical", "recommended-linked-gift-card", "recommended-orders-hour", "recommended-orders-day", "recommended-night-orders", "recommended-gift-card-repeat-100", "recommended-gift-card-amount"].includes(rule.id));
    for (const requiredRule of requiredRules) {
      if (!rules.some((rule) => rule.id === requiredRule.id)) rules.push(clone(requiredRule));
    }
    const superseded = new Set(["recommended-ip-velocity", "recommended-email-velocity", "recommended-phone-hourly-velocity", "recommended-email-daily-velocity", "recommended-ip-daily-velocity", "recommended-phone-daily-velocity", "recommended-gift-card-ip-velocity"]);
    if (introducingGroupedVelocity) for (const rule of rules) if (superseded.has(rule.id) && rule.recommended && rule.conditions.length === 1) rule.enabled = false;
  }
};

const ensureBaselineRules = (tenantId: string) => {
  if ((state.rulesByTenant.get(tenantId) ?? []).length === 0) state.rulesByTenant.set(tenantId, baselineRules());
};

export function getDashboardSnapshot(tenantId: string): DashboardSnapshot {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 86_400_000;
  const tenantStores = state.stores.filter((item) => item.tenantId === tenantId).map((store) => {
    const storeOrders = state.orders.filter((order) => order.storeId === store.id);
    const uniqueOrdersSince = (since: number) => new Set(storeOrders.filter((order) => new Date(order.createdAt).getTime() >= since).map((order) => order.shopifyOrderId)).size;
    return {
      ...store,
      ordersLast30Days: uniqueOrdersSince(thirtyDaysAgo),
      realtimeStatus: store.realtimeStatus ?? "setup-required",
    };
  });
  return {
    tenantId,
    giftCardLedger: buildGiftLedger(clone((state.giftCardOrders ?? []).filter((item) => item.tenantId === tenantId))),
    cases: clone(state.cases.filter((item) => item.tenantId === tenantId)),
    stores: clone(tenantStores),
    employees: clone(state.employees.filter((item) => item.tenantId === tenantId)),
    employeeSettings: getEmployeeSettings(tenantId),
    rules: clone(state.rulesByTenant.get(tenantId) ?? []),
    reports: clone(state.reports.filter((item) => item.tenantId === tenantId)),
    notifications: clone(state.notificationsByTenant.get(tenantId) ?? {
      tenantId, enabled: false, recipients: [], severities: ["critical"], reminderMinutes: 30,
    }),
    deliveries: clone(state.deliveries.filter((item) => item.tenantId === tenantId)),
    generatedAt: new Date().toISOString(),
  };
}

export function decideCase(tenantId: string, caseId: string, status: CaseStatus) {
  const item = state.cases.find((candidate) => candidate.tenantId === tenantId && candidate.id === caseId);
  if (!item) throw new Error("CASE_NOT_FOUND");
  item.status = status;
  if (["fraud", "false-positive", "resolved"].includes(status)) {
    item.resolution = {
      source: "merchant",
      at: new Date().toISOString(),
      note: status === "fraud" ? "בעל החנות אישר שמדובר בהונאה."
        : status === "false-positive" ? "בעל החנות סימן את ההתראה כלא חשודה."
          : "בעל החנות סגר את ההתראה כטופלה.",
    };
  } else {
    item.resolution = undefined;
  }

  if (status === "fraud") {
    const identities: Array<{ type: IdentityKind; value?: string }> = [
      { type: "email", value: item.email.includes("@") ? normalizeEmail(item.email) : undefined },
      { type: "phone", value: item.context?.phone },
      { type: "address", value: item.context?.address },
      { type: "ip", value: item.context?.ip },
      { type: "customer", value: item.context?.customerId },
    ];
    for (const identity of identities) {
      if (!identity.value) continue;
      state.globalDigests.add(digestKey(identity.type, identity.value));
      if (state.reports.some((report) => report.tenantId === tenantId && report.caseId === caseId && report.keyType === identity.type && report.status === "active")) continue;
      state.reports.unshift({
        id: randomUUID(), tenantId, caseId, keyType: identity.type, maskedValue: maskIdentity(identity.type, identity.value),
        reason: item.reason, createdAt: new Date().toISOString(), status: "active",
      });
      const report = state.reports[0];
      state.reportDigests.set(report.id, digestKey(identity.type, identity.value));
    }
  }

  state.audit.unshift({
    id: randomUUID(), tenantId, action: `case.${status}`, resourceType: "case", resourceId: caseId,
    createdAt: new Date().toISOString(), metadata: { orderNumber: item.orderNumber, score: item.score },
  });
  return clone(item);
}

export function releaseBlacklistCase(tenantId: string, caseId: string) {
  const item = state.cases.find((candidate) => candidate.tenantId === tenantId && candidate.id === caseId);
  if (!item) throw new Error("CASE_NOT_FOUND");
  const released = state.reports.filter((report) => report.tenantId === tenantId && report.caseId === caseId && report.status === "active");
  for (const report of released) {
    report.status = "revoked";
    const reportDigest = state.reportDigests.get(report.id);
    if (!reportDigest) continue;
    const usedElsewhere = state.reports.some((candidate) => candidate.id !== report.id && candidate.status === "active" && state.reportDigests.get(candidate.id) === reportDigest);
    if (!usedElsewhere) state.globalDigests.delete(reportDigest);
  }
  state.audit.unshift({
    id: randomUUID(), tenantId, action: "blocklist.released", resourceType: "case", resourceId: caseId,
    createdAt: new Date().toISOString(), metadata: { releasedIdentifiers: released.length },
  });
  return { case: clone(item), released: released.length };
}

export function updateRule(tenantId: string, ruleId: string, patch: Partial<Pick<RiskRule, "enabled" | "label" | "description" | "logic" | "conditions" | "action">>) {
  const rule = state.rulesByTenant.get(tenantId)?.find((candidate) => candidate.id === ruleId);
  if (!rule) throw new Error("RULE_NOT_FOUND");
  if (rule.locked && Object.keys(patch).some((key) => key !== "enabled")) throw new Error("RULE_LOCKED");
  Object.assign(rule, clone(patch));
  state.audit.unshift({
    id: randomUUID(), tenantId, action: "rule.updated", resourceType: "rule",
    resourceId: ruleId, createdAt: new Date().toISOString(), metadata: {},
  });
  return clone(rule);
}

const activeStatuses = new Set<CaseStatus>(["new", "review", "action"]);
const autoResolvedReason = "לא עומד עוד בחוקי הסיכון הפעילים";
const isAutoResolved = (item: FraudCase) => item.status === "resolved" && item.resolution?.source !== "merchant" &&
  (item.reason === autoResolvedReason || item.resolution?.source === "automatic-rule-change");
const canReevaluate = (item: FraudCase) => activeStatuses.has(item.status) || isAutoResolved(item);

function applyRiskResult(item: FraudCase, signals: OrderSignals, result: ReturnType<typeof evaluateRisk>) {
  if (!canReevaluate(item)) return;
  const wasAutoResolved = isAutoResolved(item);
  item.amount = signals.orderAmount;
  item.signals = clone(signals);
  if (item.context) {
    item.context.ipOrderCountLastTwoHours = signals.ordersByIpLastTwoHours;
    item.context.ipGiftCardOrderCountLastTwoHours = signals.giftCardOrdersByIpLastTwoHours;
    item.context.ipDistinctEmailsLastTwoHours = signals.emailsByIpLastTwoHours;
  }
  if (result.score < 25) {
    item.status = "resolved";
    item.reason = autoResolvedReason;
    item.resolution = { source: "automatic-rule-change", at: new Date().toISOString(),
      note: "נבדקו מחדש סכום הרכישה וחלונות הזמן של ההזמנות. לא התקיים תנאי שמצדיק התראה פעילה. זו סגירה אוטומטית, לא טיפול של בעל החנות." };
    item.score = 0;
    item.severity = "low";
    item.evidence = [];
    return;
  }
  if (wasAutoResolved) item.status = "new";
  item.resolution = undefined;
  item.score = result.score;
  item.severity = result.severity;
  item.evidence = result.evidence;
  item.reason = result.evidence[0]?.label ?? item.reason;
}

function evidenceLinkedGiftSignal(storeId: string, orderId: string) {
  return hasFlaggedGiftSource(buildGiftLedger((state.giftCardOrders ?? []).filter((order) => order.storeId === storeId)).cards,
    storeId, orderId, state.cases.map((item) => ({ storeId: item.storeId, orderId: item.context?.shopifyOrderId, status: item.status })));
}

const fallbackSignalsForCase = (item: FraudCase, tenantCases: FraudCase[]): OrderSignals => {
  const giftCardValue = item.items.reduce((total, line) => /gift\s*card|כרטיס\s*מתנה/i.test(line.name) ? total + line.price * line.quantity : total, 0);
  const averageOrderValue = tenantCases.length ? tenantCases.reduce((sum, candidate) => sum + candidate.amount, 0) / tenantCases.length : item.amount;
  const hasEvidence = (pattern: RegExp) => item.evidence.some((evidence) => pattern.test(`${evidence.label} ${evidence.description}`));
  return {
    ordersByEmailLastHour: 0,
    ordersByIpLastTwoHours: 0,
    giftCardOrdersByIpLastTwoHours: 0,
    emailsByIpLastTwoHours: 0,
    identitiesByPhoneLastDay: 0,
    orderAmount: item.amount,
    averageOrderValue,
    giftCardValue,
    giftCardBaseline: giftCardValue,
    linkedGiftCard: false,
    paymentFailures: hasEvidence(/כשל|failed payment/i) ? 3 : 0,
    billingShippingMismatch: hasEvidence(/כתובות החיוב והמשלוח שונות/i),
    shopifyRisk: item.context?.shopifyRisk === "high" ? "high" : item.context?.shopifyRisk === "medium" ? "medium" : item.context?.shopifyRisk === "low" ? "low" : "none",
    shopifyRiskFacts: item.context?.riskFacts ?? [],
    employeeMatch: item.evidence.some((evidence) => evidence.source === "employee"),
    refundAfterFulfillment: hasEvidence(/זיכוי לאחר/i),
    blacklist: {
      email: hasEvidence(/מאגר ההונאות|רשת הגנה/i), phone: false, address: false, ip: false, customer: false,
    },
  };
};

export function reevaluateOpenCases(tenantId: string) {
  const tenantCases = state.cases.filter((item) => item.tenantId === tenantId);
  const rules = state.rulesByTenant.get(tenantId) ?? [];
  const candidates = tenantCases.filter(canReevaluate);
  const velocityFor = createVelocityLookup(state.orders, rules.flatMap((rule) => rule.conditions));
  const employeeSettings = getEmployeeSettings(tenantId);
  const preserveEmployeeEvidence = (item: FraudCase, result: ReturnType<typeof evaluateRisk>) => {
    const evidence = item.evidence.filter((entry) => entry.source === "employee" && (
      (employeeSettings.zeroAmount && entry.description.includes("סכום ₪0"))
      || (employeeSettings.giftCardAddressChange && entry.description.includes("כתובת אחרת"))
      || (employeeSettings.repeatGiftCardUses && entry.description.includes("מימושי Gift Card"))
    ));
    if (evidence.length) { result.evidence.unshift(...evidence); result.score = Math.max(72, result.score); if (["low", "medium"].includes(result.severity)) result.severity = "high"; }
    return result;
  };
  let resolved = 0;
  let updated = 0;
  let reopened = 0;

  const evaluated = candidates.map((item) => {
    const base = item.signals ?? fallbackSignalsForCase(item, tenantCases);
    const stored = state.orders.find((order) => order.tenantId === tenantId && order.storeId === item.storeId && order.shopifyOrderId === item.context?.shopifyOrderId);
    const current = stored ?? {
      tenantId, storeId: item.storeId, shopifyOrderId: item.context?.shopifyOrderId ?? item.id,
      createdAt: item.occurredAt ?? "", email: item.email, ip: item.context?.ip ?? "", phone: item.context?.phone ?? "",
      amount: item.amount, giftCardValue: base.giftCardValue,
    };
    const signals: OrderSignals = { ...base, orderAmount: current.amount, linkedGiftCard: false,
      ...velocityFor(current) };
    const timestamp = Number.isFinite(Date.parse(current.createdAt)) ? new Date(current.createdAt) : new Date();
    signals.orderLocalHour = Number(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Jerusalem" }).format(timestamp));
    return { item, signals, timestamp, baseResult: preserveEmployeeEvidence(item, evaluateRisk(signals, timestamp, rules)) };
  });
  // Establish genuine source-order risk first. Stale linked alerts must not keep
  // each other alive after the false velocity alerts have been removed.
  const baseResults = new Map(evaluated.map((entry) => [entry.item.id, entry.baseResult]));
  const sourceCases = tenantCases.map((item) => ({ ...item,
    status: baseResults.has(item.id) ? (baseResults.get(item.id)!.score >= 25 ? "new" : "resolved") : item.status,
  }));
  const ledgers = new Map(state.stores.filter((store) => store.tenantId === tenantId).map((store) => [store.id,
    buildGiftLedger((state.giftCardOrders ?? []).filter((order) => order.tenantId === tenantId && order.storeId === store.id))]));

  for (const { item, signals, timestamp } of evaluated) {
    const wasAutoResolved = isAutoResolved(item);
    signals.linkedGiftCard = hasFlaggedGiftSource(ledgers.get(item.storeId)?.cards ?? [], item.storeId, item.context?.shopifyOrderId ?? "",
      sourceCases.map((source) => ({ storeId: source.storeId, orderId: source.context?.shopifyOrderId, status: source.status })))
      || Boolean(item.context?.giftCards?.redeemed.some((redemption) => redemption.identityChanged && redemption.confidence === "exact-id" &&
        sourceCases.some((source) => source.storeId === item.storeId && source.orderNumber === redemption.purchaseOrderNumber && ["new", "review", "action", "fraud"].includes(source.status))));
    const result = preserveEmployeeEvidence(item, evaluateRisk(signals, timestamp, rules));
    applyRiskResult(item, signals, result);
    if (result.score < 25) {
      if (!wasAutoResolved) resolved += 1;
      continue;
    }
    if (wasAutoResolved) {
      reopened += 1;
    }
    updated += 1;
  }

  state.audit.unshift({
    id: randomUUID(), tenantId, action: "cases.reevaluated", resourceType: "risk_rules", resourceId: tenantId,
    createdAt: new Date().toISOString(), metadata: { reviewed: candidates.length, updated, resolved, reopened },
  });
  return {
    reviewed: candidates.length,
    updated,
    resolved,
    reopened,
    active: tenantCases.filter((item) => activeStatuses.has(item.status)).length,
    cases: clone(tenantCases),
  };
}

/** Explicit, idempotent policy correction for the merchant who requested it.
 * Never reapply on hydration: later edits remain the merchant's choice.
 */
export function repairVelocityPolicy(tenantId: string) {
  const migration = "risk.velocity-windows-v4";
  const alreadyApplied = state.audit.some((event) => event.tenantId === tenantId && event.action === migration);
  if (!alreadyApplied) {
    const rules = state.rulesByTenant.get(tenantId);
    if (!rules) throw new Error("RULE_NOT_FOUND");
    const policyIds = ["recommended-orders-hour", "recommended-orders-day", "recommended-order-spike"];
    for (const baseline of baselineRules().filter((rule) => policyIds.includes(rule.id))) {
      const existing = rules.find((rule) => rule.id === baseline.id);
      if (existing) Object.assign(existing, { label: baseline.label, description: baseline.description, conditions: clone(baseline.conditions), logic: baseline.logic, enabled: true });
      else rules.push(clone(baseline));
    }
    state.audit.unshift({ id: randomUUID(), tenantId, action: migration, resourceType: "risk_rules", resourceId: tenantId,
      createdAt: new Date().toISOString(), metadata: { hour: 60, hourlyThreshold: 3, day: 1440, dailyThreshold: 5, amountThreshold: 1500 } });
  }
  return { alreadyApplied, ...reevaluateOpenCases(tenantId) };
}

// Locate newly qualifying historical orders without inventing customer/item data.
// The caller fetches their original Shopify details before creating any case.
export function pendingVelocityPolicyOrders(tenantId: string) {
  const policy = (state.rulesByTenant.get(tenantId) ?? []).filter((rule) => [
    "recommended-orders-hour", "recommended-orders-day", "recommended-order-spike",
  ].includes(rule.id));
  const known = new Set(state.cases.filter((item) => item.tenantId === tenantId).map((item) => `${item.storeId}:${item.context?.shopifyOrderId}`));
  const orders = state.orders.filter((order) => order.tenantId === tenantId && Number.isFinite(Date.parse(order.createdAt)) && !known.has(`${order.storeId}:${order.shopifyOrderId}`));
  const velocityFor = createVelocityLookup(state.orders, policy.flatMap((rule) => rule.conditions));
  return orders.filter((order) => evaluateRisk({
    ...velocityFor(order), orderAmount: order.amount, averageOrderValue: 0, giftCardValue: order.giftCardValue, giftCardBaseline: 0,
    linkedGiftCard: false, paymentFailures: 0, billingShippingMismatch: false, shopifyRisk: "none", employeeMatch: false, refundAfterFulfillment: false,
    blacklist: { email: false, phone: false, address: false, ip: false, customer: false },
  }, new Date(order.createdAt), policy).score >= 25).map((order) => ({ storeId: order.storeId, orderId: order.shopifyOrderId }));
}

export function createRule(tenantId: string, input: Omit<RiskRule, "id" | "matches">) {
  const rule: RiskRule = { ...clone(input), id: randomUUID(), matches: 0, locked: false };
  const rules = state.rulesByTenant.get(tenantId) ?? [];
  rules.unshift(rule);
  state.rulesByTenant.set(tenantId, rules);
  state.audit.unshift({ id: randomUUID(), tenantId, action: "rule.created", resourceType: "rule", resourceId: rule.id, createdAt: new Date().toISOString(), metadata: {} });
  return clone(rule);
}

export function updateNotificationSettings(tenantId: string, patch: Partial<Omit<NotificationSettings, "tenantId">>) {
  const current = state.notificationsByTenant.get(tenantId) ?? { tenantId, enabled: false, recipients: [], severities: ["critical"], reminderMinutes: 30 } satisfies NotificationSettings;
  const next = { ...current, ...clone(patch), tenantId };
  state.notificationsByTenant.set(tenantId, next);
  state.audit.unshift({ id: randomUUID(), tenantId, action: "notifications.updated", resourceType: "notification_settings", resourceId: tenantId, createdAt: new Date().toISOString(), metadata: { recipientCount: next.recipients.length } });
  return clone(next);
}

export function getNotificationSettings(tenantId: string) {
  return clone(state.notificationsByTenant.get(tenantId) ?? { tenantId, enabled: false, recipients: [], severities: ["critical"], reminderMinutes: 30 } satisfies NotificationSettings);
}

export function recordNotificationDelivery(delivery: NotificationDelivery) {
  state.deliveries.unshift(clone(delivery));
}

export function getEmployeeSettings(tenantId: string): EmployeeMonitoringSettings {
  return clone(state.employeeSettingsByTenant.get(tenantId) ?? { tenantId, couponPrefix: "", zeroAmount: true, giftCardAddressChange: true, repeatGiftCardUses: true, repeatUsesThreshold: 3, windowMinutes: 1440 });
}

export function saveEmployeeSettings(tenantId: string, input: EmployeeMonitoringSettings) {
  const settings = { ...input, tenantId, couponPrefix: input.couponPrefix.trim().toLowerCase(), repeatUsesThreshold: Math.max(2, Math.floor(input.repeatUsesThreshold)), windowMinutes: Math.max(1, Math.floor(input.windowMinutes)) };
  state.employeeSettingsByTenant.set(tenantId, settings);
  state.audit.unshift({ id: randomUUID(), tenantId, action: "employee.settings.updated", resourceType: "employee", resourceId: tenantId, createdAt: new Date().toISOString(), metadata: {} });
  return clone(settings);
}

export function addEmployee(tenantId: string, input: Pick<Employee, "name" | "email" | "department"> & Partial<Pick<Employee, "privateEmail" | "address" | "couponCodes">>) {
  const email = normalizeEmail(input.email);
  if (state.employees.some((employee) => employee.tenantId === tenantId && normalizeEmail(employee.email) === email)) {
    throw new Error("EMPLOYEE_ALREADY_EXISTS");
  }
  const employee: Employee = {
    id: randomUUID(), tenantId, name: input.name.trim(), email, privateEmail: normalizeEmail(input.privateEmail ?? ""), address: input.address?.trim() ?? "", couponCodes: input.couponCodes?.map((code) => code.trim().toLowerCase()).filter(Boolean) ?? [], department: input.department.trim(),
    purchases: 0, refunded: 0, risk: "low",
  };
  employee.purchases = state.orders.filter((order) => order.tenantId === tenantId && (
    [employee.email, employee.privateEmail].includes(order.email) || Boolean(employee.address && order.address && normalizeAddress(employee.address) === normalizeAddress(order.address))
    || Boolean(order.couponCodes?.some((code) => employee.couponCodes?.includes(code)))
  )).length;
  state.employees.unshift(employee);
  state.audit.unshift({
    id: randomUUID(), tenantId, action: "employee.created", resourceType: "employee", resourceId: employee.id,
    createdAt: new Date().toISOString(), metadata: { department: employee.department },
  });
  return clone(employee);
}

export function updateEmployee(tenantId: string, employeeId: string, input: Pick<Employee, "name" | "email" | "department"> & Partial<Pick<Employee, "privateEmail" | "address" | "couponCodes">>) {
  const employee = state.employees.find((candidate) => candidate.tenantId === tenantId && candidate.id === employeeId);
  if (!employee) throw new Error("EMPLOYEE_NOT_FOUND");
  const email = normalizeEmail(input.email);
  if (state.employees.some((candidate) => candidate.tenantId === tenantId && candidate.id !== employeeId && normalizeEmail(candidate.email) === email)) throw new Error("EMPLOYEE_ALREADY_EXISTS");
  Object.assign(employee, { name: input.name.trim(), email, privateEmail: normalizeEmail(input.privateEmail ?? ""), address: input.address?.trim() ?? "", couponCodes: input.couponCodes?.map((code) => code.trim().toLowerCase()).filter(Boolean) ?? [], department: input.department.trim() });
  employee.purchases = state.orders.filter((order) => order.tenantId === tenantId && (
    [employee.email, employee.privateEmail].includes(order.email) || Boolean(employee.address && order.address && normalizeAddress(employee.address) === normalizeAddress(order.address))
    || Boolean(order.couponCodes?.some((code) => employee.couponCodes?.includes(code)))
  )).length;
  state.audit.unshift({ id: randomUUID(), tenantId, action: "employee.updated", resourceType: "employee", resourceId: employeeId, createdAt: new Date().toISOString(), metadata: {} });
  return clone(employee);
}

export function resolveStore(storeId: string) {
  const store = state.stores.find((item) => item.id === storeId);
  return store ? clone(store) : null;
}

export function connectShopifyStore(input: {
  tenantId: string;
  name: string;
  domain: string;
  accessToken: string;
  clientSecret: string;
  expiresIn: number;
}) {
  ensureBaselineRules(input.tenantId);
  const existing = state.stores.find((store) => store.tenantId === input.tenantId && store.domain === input.domain);
  const store: Store = existing ?? {
    id: randomUUID(), tenantId: input.tenantId, name: input.name, domain: input.domain,
    status: "syncing", lastEventAt: "מסנכרן 30 יום אחרונים", ordersToday: 0, ordersLast30Days: 0,
    realtimeStatus: "configuring",
  };
  store.name = input.name;
  store.status = "syncing";
  store.realtimeStatus = "configuring";
  if (!existing) state.stores.unshift(store);
  state.storeConnections.set(store.id, {
    accessToken: input.accessToken,
    webhookSecret: input.clientSecret,
    expiresAt: new Date(Date.now() + input.expiresIn * 1000).toISOString(),
  });
  state.audit.unshift({
    id: randomUUID(), tenantId: input.tenantId, action: existing ? "store.reconnected" : "store.connected",
    resourceType: "store", resourceId: store.id, createdAt: new Date().toISOString(), metadata: { domain: store.domain },
  });
  return clone(store);
}

export function getStoreConnection(tenantId: string, storeId: string) {
  const store = tenantStore(tenantId, storeId);
  const connection = state.storeConnections.get(storeId);
  if (!connection) throw new Error("STORE_CONNECTION_NOT_FOUND");
  if (new Date(connection.expiresAt).getTime() <= Date.now()) throw new Error("SHOPIFY_TOKEN_EXPIRED");
  return { store: clone(store), ...clone(connection) };
}

export function getStoreWebhookSecret(storeId: string) {
  return state.storeConnections.get(storeId)?.webhookSecret;
}

export function markStoreRealtimeReady(tenantId: string, storeId: string) {
  const store = tenantStore(tenantId, storeId);
  store.realtimeStatus = "registered";
  store.webhookRegisteredAt = new Date().toISOString();
  return clone(store);
}

export function markStoreRealtimeError(tenantId: string, storeId: string) {
  const store = tenantStore(tenantId, storeId);
  store.realtimeStatus = "error";
  return clone(store);
}

export function completeHistoricalSync(tenantId: string, storeId: string, scanned: number, latestOrderAt?: string, giftCardTracking?: { status: NonNullable<Store["giftCardTrackingStatus"]>; tracked: number }) {
  const store = tenantStore(tenantId, storeId);
  store.status = "active";
  store.ordersLast30Days = scanned;
  store.lastSyncAt = new Date().toISOString();
  if (giftCardTracking) {
    store.giftCardTrackingStatus = giftCardTracking.status;
    store.giftCardsTracked = giftCardTracking.tracked;
    store.lastGiftCardSyncAt = new Date().toISOString();
  }
  store.lastEventAt = latestOrderAt
    ? new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(new Date(latestOrderAt))
    : "לא נמצאו הזמנות ב־30 הימים האחרונים";
  reevaluateOpenCases(tenantId);
  return clone(store);
}

export function failHistoricalSync(tenantId: string, storeId: string) {
  const store = tenantStore(tenantId, storeId);
  store.status = "degraded";
  store.lastEventAt = "החיבור הצליח, סנכרון ההזמנות נכשל";
}

const addressOf = (payload: ShopifyOrderPayload) => {
  const address = payload.shipping_address;
  return normalizeAddress([address?.address1, address?.city, address?.zip].filter(Boolean).join(" "));
};

const sameAddress = (left?: ShopifyOrderPayload["billing_address"], right?: ShopifyOrderPayload["shipping_address"]) => {
  const serialize = (value: typeof left) => normalizeAddress([value?.address1, value?.city, value?.zip].filter(Boolean).join(" "));
  return serialize(left) === serialize(right);
};


export function replaceGiftCardRegistry(tenantId: string, storeId: string, cards: GiftCardRegistryInput[]) {
  // A rolling fetch window is not a retention policy: never erase older evidence.
  return upsertGiftCardRegistry(tenantId, storeId, cards);
}

export function upsertGiftCardRegistry(tenantId: string, storeId: string, cards: GiftCardRegistryInput[]) {
  tenantStore(tenantId, storeId);
  for (const card of cards) {
    const existing = state.giftCards.find((item) => item.storeId === storeId && item.giftCardId === card.giftCardId);
    if (existing) {
      Object.assign(existing, clone(card));
      continue;
    }
    state.giftCards.push({ ...clone(card), tenantId, storeId, redemptions: [] });
  }
  return cards.length;
}

const traceOf = (card: StoredGiftCard): GiftCardTrace => ({
  giftCardId: card.giftCardId,
  maskedCode: card.maskedCode,
  lastCharacters: card.lastCharacters,
  initialValue: card.initialValue,
  balance: card.balance,
  purchaseOrderId: card.purchaseOrderId,
  purchaseOrderNumber: card.purchaseOrderNumber,
  redemptions: clone(card.redemptions),
});

const refreshGiftCardLinks = (storeId: string) => {
  const cards = state.giftCards.filter((card) => card.storeId === storeId);
  for (const item of state.cases.filter((candidate) => candidate.storeId === storeId && candidate.context?.shopifyOrderId)) {
    const orderId = item.context!.shopifyOrderId!;
    const issued = cards.filter((card) => card.purchaseOrderId === orderId).map(traceOf);
    const redeemed = cards.flatMap((card) => card.redemptions.filter((redemption) => redemption.orderId === orderId));
    if (issued.length || redeemed.length) item.context!.giftCards = { issued, redeemed: clone(redeemed) };
  }
  refreshOrderEvidenceLinks(storeId);
};

export function refreshOrderEvidenceLinks(storeId: string) {
  const ledger = buildGiftLedger((state.giftCardOrders ?? []).filter((order) => order.storeId === storeId));
  const redemptionOf = (card: typeof ledger.cards[number], use: typeof card.uses[number]): GiftCardRedemption => ({
    giftCardId: card.giftCardId, maskedCode: card.lastCharacters ? `•••• ${card.lastCharacters}` : "קוד מוסתר",
    transactionId: use.transactionId, amount: use.amount, currency: use.currency, orderId: use.order.orderId,
    orderNumber: use.order.orderNumber, customer: use.order.customer, email: use.order.email,
    redeemedAt: use.processedAt, purchaseOrderNumber: card.purchase?.orderNumber,
    purchaserCustomer: card.purchase?.customer, purchaserEmail: card.purchase?.email,
    confidence: "exact-id", identityChanged: Boolean(card.purchase?.email && use.order.email && card.purchase.email !== use.order.email),
  });
  for (const item of state.cases.filter((entry) => entry.storeId === storeId && entry.context?.shopifyOrderId)) {
    const orderId = item.context!.shopifyOrderId;
    const issued = ledger.cards.filter((card) => !card.purchaseConflict && card.purchase?.orderId === orderId).map((card): GiftCardTrace => ({
      giftCardId: card.giftCardId, maskedCode: card.lastCharacters ? `•••• ${card.lastCharacters}` : "קוד מוסתר",
      lastCharacters: card.lastCharacters, initialValue: null, balance: null, purchaseOrderId: orderId,
      purchaseOrderNumber: card.purchase?.orderNumber,
      redemptions: card.uses.filter((use) => use.kind !== "REFUND").map((use) => redemptionOf(card, use)),
    }));
    const redeemed = ledger.cards.filter((card) => !card.purchaseConflict).flatMap((card) => card.uses
      .filter((use) => use.order.orderId === orderId && use.kind !== "REFUND").map((use) => redemptionOf(card, use)));
    if (issued.length || redeemed.length) item.context!.giftCards = { issued, redeemed };
  }
}

export function recordGiftCardOrderEvidence(order: GiftCardOrderEvidence, refresh = true) {
  const store = tenantStore(order.tenantId, order.storeId);
  state.giftCardOrders ??= [];
  const index = state.giftCardOrders.findIndex((item) => item.storeId === order.storeId && item.orderId === order.orderId);
  const previous = state.giftCardOrders[index];
  // Preserve positive evidence if Shopify returns a partial timeline on a later request.
  const merged = clone(order);
  merged.purchaseAmounts ??= previous?.purchaseAmounts;
  merged.issued = [...new Map([...(previous?.issued ?? []), ...order.issued].map((item) => [item.giftCardId, item])).values()];
  merged.uses = [...new Map([...(previous?.uses ?? []), ...order.uses].map((item) => [item.transactionId, item])).values()];
  if (index < 0) state.giftCardOrders.push(merged); else state.giftCardOrders[index] = merged;
  if (!store.lastGiftCardSyncAt || order.checkedAt > store.lastGiftCardSyncAt) store.lastGiftCardSyncAt = order.checkedAt;
  if (refresh) refreshOrderEvidenceLinks(order.storeId);
}

export function giftCardAlertOrderIds(tenantId: string, storeId: string) {
  tenantStore(tenantId, storeId);
  return [...new Set(state.cases.filter((item) => item.tenantId === tenantId && item.storeId === storeId && (
    item.items.some((line) => /gift\s*card|גיפט\s*קארד|כרטיס\s*מתנה/i.test(line.name))
    || item.context?.paymentGateways.some((gateway) => /gift.?card/i.test(gateway))
  )).map((item) => item.context?.shopifyOrderId).filter((id): id is string => Boolean(id)))];
}

export function ingestShopifyOrder(input: { storeId: string; webhookId: string; topic: string; payload: ShopifyOrderPayload }) {
  const store = state.stores.find((item) => item.id === input.storeId);
  if (!store) throw new Error("STORE_NOT_FOUND");
  if (input.topic !== "HISTORICAL_SYNC") {
    store.realtimeStatus = "active";
    store.lastWebhookAt = new Date().toISOString();
  }
  const seenWebhook = state.webhookIds.has(`${input.storeId}:${input.webhookId}`);
  if (seenWebhook && input.topic !== "HISTORICAL_SYNC") return { duplicate: true as const, case: null };
  if (!seenWebhook) state.webhookIds.add(`${input.storeId}:${input.webhookId}`);

  const payload = input.payload;
  const shopifyOrderId = String(payload.admin_graphql_api_id ?? payload.id ?? randomUUID());
  const tags = Array.isArray(payload.tags) ? payload.tags : String(payload.tags ?? "").split(",");
  if (tags.some((tag) => tag.trim().toLowerCase() === "external-order")) {
    state.orders = state.orders.filter((order) => !(order.storeId === store.id && order.shopifyOrderId === shopifyOrderId));
    const existingCase = state.cases.find((item) => item.storeId === store.id && item.context?.shopifyOrderId === shopifyOrderId);
    if (existingCase && canReevaluate(existingCase)) {
      existingCase.status = "resolved";
      existingCase.reason = "הזמנה חיצונית — אינה נכללת בניתוח";
      existingCase.resolution = { source: "automatic-rule-change", at: new Date().toISOString(), note: "להזמנה יש תג external-order והיא הוחרגה מהניתוח." };
      existingCase.score = 0;
      existingCase.evidence = [];
    }
    return { duplicate: false as const, case: null };
  }
  const rawEmail = normalizeEmail(payload.email ?? payload.customer?.email ?? "");
  const sharedServiceEmail = isSharedServiceEmail(rawEmail);
  const email = sharedServiceEmail ? "" : rawEmail;
  const phone = normalizePhone(payload.phone ?? payload.customer?.phone ?? payload.shipping_address?.phone ?? "");
  const ip = (payload.client_ip ?? payload.browser_ip ?? "").trim();
  const customerId = String(payload.customer?.admin_graphql_api_id ?? payload.customer?.id ?? "");
  const address = addressOf(payload);
  const couponCodes = (payload.discount_codes ?? []).map((code) => code.trim().toLowerCase()).filter(Boolean);
  const amount = Number(payload.total_price ?? 0);
  const lineItems = payload.line_items ?? [];
  const giftCardValue = lineItems.reduce((total, item) => {
    const isGiftCard = item.gift_card || /gift\s*card|גיפט\s*קארד|כרטיס\s*מתנה/i.test(`${item.title ?? ""} ${item.name ?? ""} ${item.product_type ?? ""}`);
    return total + (isGiftCard ? Number(item.price ?? 0) * Number(item.quantity ?? 1) : 0);
  }, 0);
  const createdAt = payload.created_at ?? new Date().toISOString();
  const customerName = [payload.customer?.first_name, payload.customer?.last_name].filter(Boolean).join(" ");
  const addressName = [payload.shipping_address?.first_name ?? payload.billing_address?.first_name, payload.shipping_address?.last_name ?? payload.billing_address?.last_name].filter(Boolean).join(" ");
  const customer = sharedServiceEmail && addressName ? addressName : customerName || addressName || "לקוח Shopify";
  const storeGiftCards = state.giftCards.filter((card) => card.storeId === store.id);
  const issuedGiftCards = storeGiftCards.filter((card) => card.purchaseOrderId === shopifyOrderId);
  for (const card of issuedGiftCards) {
    card.purchaseOrderNumber = payload.name ?? card.purchaseOrderNumber;
    card.purchaserCustomer = customer;
    card.purchaserEmail = email || undefined;
    card.purchaserCustomerId = customerId || undefined;
  }
  const redeemedGiftCards: GiftCardRedemption[] = [];
  for (const transaction of payload.transactions ?? []) {
    if (transaction.status?.toUpperCase() !== "SUCCESS" || !["SALE", "CAPTURE"].includes(transaction.kind?.toUpperCase() ?? "")) continue;
    const exactId = receiptGiftCard(transaction.receipt).id;
    const candidates = exactId
      ? storeGiftCards.filter((card) => card.giftCardId === exactId)
      : [];
    if (candidates.length !== 1) continue;
    const card = candidates[0];
    if (card.purchaseOrderId === shopifyOrderId) continue;
    const confidence: GiftCardRedemption["confidence"] = exactId ? "exact-id" : "unique-last4";
    const identityChanged = Boolean(
      (card.purchaserEmail && email && card.purchaserEmail !== email)
      || (card.purchaserCustomerId && customerId && card.purchaserCustomerId !== customerId)
      || (!card.purchaserEmail && !card.purchaserCustomerId && card.purchaserCustomer && customer && card.purchaserCustomer !== customer)
    );
    const redemption: GiftCardRedemption = {
      giftCardId: card.giftCardId,
      transactionId: transaction.id,
      maskedCode: card.maskedCode,
      amount: Number(transaction.amount ?? 0),
      orderId: shopifyOrderId,
      orderNumber: payload.name ?? `#${String(payload.id ?? "NEW")}`,
      customer,
      email: email || "לא התקבל מ־Shopify",
      redeemedAt: transaction.processed_at ?? createdAt,
      purchaseOrderNumber: card.purchaseOrderNumber,
      purchaserCustomer: card.purchaserCustomer,
      purchaserEmail: card.purchaserEmail,
      confidence,
      identityChanged,
    };
    if (transaction.id && !card.redemptions.some((item) => item.transactionId === transaction.id)) card.redemptions.push(redemption);
    redeemedGiftCards.push(redemption);
  }
  const linkedGiftCard = redeemedGiftCards.some((redemption) => {
    if (!redemption.identityChanged || redemption.confidence === "ambiguous") return false;
    const sourceCard = storeGiftCards.find((card) => card.giftCardId === redemption.giftCardId);
    return state.cases.some((item) => item.storeId === store.id && ["new", "review", "action", "fraud"].includes(item.status) && (
      item.context?.shopifyOrderId === sourceCard?.purchaseOrderId
      || Boolean(sourceCard?.purchaserEmail && item.email.includes("@") && normalizeEmail(item.email) === sourceCard.purchaserEmail)
    ));
  }) || evidenceLinkedGiftSignal(store.id, shopifyOrderId);
  const existingOrder = state.orders.find((order) => order.storeId === store.id && order.shopifyOrderId === shopifyOrderId);
  const existingCaseBeforeEvaluation = state.cases.find((item) => item.storeId === store.id && (item.context?.shopifyOrderId === shopifyOrderId || (payload.name && item.orderNumber === payload.name)));
  const newlyHighShopifyRisk = payload.risk_level === "high" && existingCaseBeforeEvaluation?.signals?.shopifyRisk !== "high";
  if (existingCaseBeforeEvaluation?.context && !existingCaseBeforeEvaluation.context.shopifyOrderId) existingCaseBeforeEvaluation.context.shopifyOrderId = shopifyOrderId;
  if (existingCaseBeforeEvaluation?.context) {
    existingCaseBeforeEvaluation.context.shopifyRisk = payload.risk_level ?? existingCaseBeforeEvaluation.context.shopifyRisk;
    if (payload.shopify_risk_facts?.length) existingCaseBeforeEvaluation.context.riskFacts = payload.shopify_risk_facts;
  }
  const recentOrders = state.orders.filter((order) => order.storeId === store.id && order.shopifyOrderId !== shopifyOrderId);
  const velocity = computeVelocitySignals({ tenantId: store.tenantId, storeId: store.id, shopifyOrderId, email, ip, phone, amount, giftCardValue, createdAt },
    recentOrders, (state.rulesByTenant.get(store.tenantId) ?? []).flatMap((rule) => rule.conditions));
  const { ordersByIpLastTwoHours: sameIp, giftCardOrdersByIpLastTwoHours: giftCardOrdersByIp, emailsByIpLastTwoHours: emailsByIp } = velocity;
  const averageOrderValue = recentOrders.length ? recentOrders.reduce((sum, order) => sum + order.amount, 0) / recentOrders.length : amount;
  const giftCardBaseline = recentOrders.length ? recentOrders.reduce((sum, order) => sum + order.giftCardValue, 0) / Math.max(1, recentOrders.length) : giftCardValue;
  const employeeFor = (candidate: { email: string; address: string; couponCodes?: string[] }) => state.employees.find((employee) => employee.tenantId === store.tenantId && (
    Boolean(candidate.email && [employee.email, employee.privateEmail].some((value) => value && normalizeEmail(value) === candidate.email))
    || Boolean(candidate.address && employee.address && normalizeAddress(employee.address) === normalizeAddress(candidate.address))
    || Boolean(candidate.couponCodes?.some((code) => employee.couponCodes?.includes(code)))
  ));
  const matchedEmployee = employeeFor({ email, address, couponCodes });
  const employeeMatch = Boolean(matchedEmployee);

  const signals: OrderSignals = {
    ...velocity,
    orderAmount: amount,
    averageOrderValue,
    giftCardValue,
    giftCardBaseline,
    linkedGiftCard,
    paymentFailures: Number(payload.payment_failures ?? 0),
    billingShippingMismatch: Boolean(payload.billing_address && payload.shipping_address && !sameAddress(payload.billing_address, payload.shipping_address)),
    shopifyRisk: payload.risk_level ?? "none",
    shopifyRiskFacts: payload.shopify_risk_facts ?? [],
    orderLocalHour: Number(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Jerusalem" }).format(new Date(createdAt))),
    employeeMatch,
    refundAfterFulfillment: Boolean(payload.refund_after_fulfillment),
    blacklist: {
      email: Boolean(email && state.globalDigests.has(digestKey("email", email))),
      phone: Boolean(phone && state.globalDigests.has(digestKey("phone", phone))),
      address: Boolean(address && state.globalDigests.has(digestKey("address", address))),
      ip: Boolean(ip && state.globalDigests.has(digestKey("ip", ip))),
      customer: Boolean(customerId && state.globalDigests.has(digestKey("customer", customerId))),
    },
  };

  if (amount <= 0 && giftCardValue <= 0) {
    signals.ordersByEmailLastHour = 0;
    signals.ordersByIpLastTwoHours = 0;
    signals.giftCardOrdersByIpLastTwoHours = 0;
    signals.emailsByIpLastTwoHours = 0;
  }

  const order: StoredOrder = {
    tenantId: store.tenantId, storeId: store.id,
    shopifyOrderId,
    email, phone, address, couponCodes, amount, giftCardValue, ip, customerId, createdAt,
  };
  if (existingOrder) Object.assign(existingOrder, order);
  else state.orders.push(order);
  if (matchedEmployee && !existingOrder) matchedEmployee.purchases += 1;
  if (matchedEmployee && input.topic === "refunds/create" && payload.refund_after_fulfillment) matchedEmployee.refunded += 1;
  const orderTime = new Date(createdAt).getTime();
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (!existingOrder && orderTime >= startOfToday) store.ordersToday += 1;
  if (!existingOrder && orderTime >= Date.now() - 30 * 86_400_000) store.ordersLast30Days += 1;
  if (input.topic !== "HISTORICAL_SYNC") {
    store.lastEventAt = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(new Date(createdAt));
  }

  const result = evaluateRisk(signals, new Date(createdAt), state.rulesByTenant.get(store.tenantId) ?? []);
  const employeeSettings = getEmployeeSettings(store.tenantId);
  const employeeFindings: string[] = [];
  if (matchedEmployee && employeeSettings.zeroAmount && amount === 0) employeeFindings.push(`הזמנה בסכום ₪0 תואמת לפרטי העובד ${matchedEmployee.name}.`);
  const employeeRedemptions = redeemedGiftCards.flatMap((redemption) => {
    const card = storeGiftCards.find((candidate) => candidate.giftCardId === redemption.giftCardId);
    const purchase = state.orders.find((candidate) => candidate.storeId === store.id && candidate.shopifyOrderId === card?.purchaseOrderId);
    const sourceEmployee = purchase ? employeeFor(purchase) : undefined;
    return sourceEmployee && purchase ? [{ redemption, card, purchase, sourceEmployee }] : [];
  });
  if (employeeSettings.giftCardAddressChange && employeeRedemptions.some(({ purchase }) => purchase.address && address && normalizeAddress(purchase.address) !== normalizeAddress(address))) {
    employeeFindings.push("Gift Card שנרכש באמצעות פרטי עובד מומש בהזמנה עם כתובת אחרת.");
  }
  if (employeeSettings.repeatGiftCardUses) {
    const end = Date.parse(createdAt);
    const uses = new Set(employeeRedemptions.flatMap(({ sourceEmployee }) => storeGiftCards.filter((card) => {
      const purchase = state.orders.find((candidate) => candidate.storeId === store.id && candidate.shopifyOrderId === card.purchaseOrderId);
      return purchase && employeeFor(purchase)?.id === sourceEmployee.id;
    }).flatMap((card) => card.redemptions.filter((redemption) => {
      const time = Date.parse(redemption.redeemedAt);
      return Number.isFinite(time) && time <= end && time > end - employeeSettings.windowMinutes * 60_000;
    }).map((redemption) => redemption.transactionId ?? `${redemption.giftCardId}:${redemption.orderId}`))));
    if (uses.size >= employeeSettings.repeatUsesThreshold) employeeFindings.push(`${uses.size} מימושי Gift Card הקשורים לעובד בתוך ${employeeSettings.windowMinutes} דקות.`);
  }
  if (employeeFindings.length) {
    result.evidence.unshift({ id: `employee-${shopifyOrderId}`, label: "ניטור עובדים", description: employeeFindings.join(" "), source: "employee", delta: 72, timestamp: createdAt });
    result.score = Math.max(result.score, 72);
    if (result.severity === "low" || result.severity === "medium") result.severity = "high";
  }
  for (const ruleId of result.matchedRuleIds) {
    const matchedRule = state.rulesByTenant.get(store.tenantId)?.find((rule) => rule.id === ruleId);
    if (matchedRule && (!existingOrder || !existingCaseBeforeEvaluation?.evidence.some((evidence) => evidence.label === matchedRule.label))) matchedRule.matches += 1;
  }
  if (result.score < 25) {
    if (existingCaseBeforeEvaluation) applyRiskResult(existingCaseBeforeEvaluation, signals, result);
    refreshGiftCardLinks(store.id);
    return { duplicate: false as const, case: null, risk: result };
  }

  const existingCase = existingCaseBeforeEvaluation;
  if (existingCase) {
    const previousScore = existingCase.score;
    const wasEligible = canReevaluate(existingCase);
    applyRiskResult(existingCase, signals, result);
    refreshGiftCardLinks(store.id);
    return { duplicate: false as const, case: wasEligible && (result.score > previousScore || newlyHighShopifyRisk) ? clone(existingCase) : null, risk: result };
  }
  const fraudCase: FraudCase = {
    id: randomUUID(), tenantId: store.tenantId, storeId: store.id, storeName: store.name,
    orderNumber: payload.name ?? `#${String(payload.id ?? "NEW")}`, customer, email: email || (sharedServiceEmail ? "לא זמין — עסקת PayPlus" : "לא זמין"),
    amount, score: result.score, severity: result.severity, status: "new",
    reason: result.evidence[0]?.label ?? "חריגה במנוע הסיכון",
    occurredAt: createdAt,
    createdAt: input.topic === "HISTORICAL_SYNC"
      ? new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(new Date(createdAt))
      : "עכשיו",
    evidence: result.evidence,
    signals: clone(signals),
    items: lineItems.map((item) => ({ name: item.title ?? item.name ?? "פריט", quantity: Number(item.quantity ?? 1), price: Number(item.price ?? 0) })),
    context: {
      ip: ip || undefined,
      customerId: customerId || undefined,
      phone: phone || undefined,
      address: address || undefined,
      paymentGateways: payload.gateway_names ?? [],
      shopifyRisk: payload.risk_level && payload.risk_level !== "none" ? payload.risk_level : undefined,
      riskFacts: payload.shopify_risk_facts ?? [],
      ipOrderCountLastTwoHours: ip ? sameIp : undefined,
      ipGiftCardOrderCountLastTwoHours: ip ? giftCardOrdersByIp : undefined,
      ipDistinctEmailsLastTwoHours: ip ? emailsByIp : undefined,
      shopifyOrderId,
    },
  };
  state.cases.unshift(fraudCase);
  refreshGiftCardLinks(store.id);
  state.audit.unshift({
    id: randomUUID(), tenantId: store.tenantId, action: "case.created", resourceType: "case", resourceId: fraudCase.id,
    createdAt: new Date().toISOString(), metadata: { topic: input.topic, score: result.score },
  });
  return { duplicate: false as const, case: clone(fraudCase), risk: result };
}

export function assertStoreTenant(tenantId: string, storeId: string) {
  tenantStore(tenantId, storeId);
}
