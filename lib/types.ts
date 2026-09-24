export type Severity = "low" | "medium" | "high" | "critical";
export type CaseStatus = "new" | "review" | "action" | "fraud" | "false-positive" | "resolved";
export type UserRole = "platform-owner" | "tenant-owner" | "tenant-admin" | "analyst" | "viewer";

export interface Store {
  id: string;
  tenantId: string;
  name: string;
  domain: string;
  status: "active" | "syncing" | "degraded" | "disabled";
  lastEventAt: string;
  ordersToday: number;
  ordersLast30Days: number;
  lastSyncAt?: string;
}

export interface Evidence {
  id: string;
  label: string;
  description: string;
  source: "network" | "shopify" | "behavior" | "employee";
  delta: number;
  timestamp: string;
}

export interface FraudCase {
  id: string;
  tenantId: string;
  storeId: string;
  storeName: string;
  orderNumber: string;
  customer: string;
  email: string;
  amount: number;
  score: number;
  severity: Severity;
  status: CaseStatus;
  reason: string;
  createdAt: string;
  occurredAt?: string;
  assignee?: string;
  evidence: Evidence[];
  items: { name: string; quantity: number; price: number }[];
  signals?: {
    ordersByEmailLastHour: number;
    ordersByIpLastTwoHours: number;
    giftCardOrdersByIpLastTwoHours: number;
    emailsByIpLastTwoHours: number;
    identitiesByPhoneLastDay: number;
    orderAmount: number;
    averageOrderValue: number;
    giftCardValue: number;
    giftCardBaseline: number;
    paymentFailures: number;
    billingShippingMismatch: boolean;
    shopifyRisk: "none" | "low" | "medium" | "high";
    employeeMatch: boolean;
    refundAfterFulfillment: boolean;
    blacklist: { email: boolean; phone: boolean; address: boolean; ip: boolean; customer: boolean };
  };
  context?: {
    ip?: string;
    customerId?: string;
    phone?: string;
    address?: string;
    paymentGateways: string[];
    shopifyRisk?: string;
    riskFacts: string[];
    ipOrderCountLastTwoHours?: number;
    ipGiftCardOrderCountLastTwoHours?: number;
    ipDistinctEmailsLastTwoHours?: number;
  };
}

export interface RiskRule {
  id: string;
  label: string;
  description: string;
  category: "velocity" | "identity" | "payment" | "gift-card" | "employee" | "network";
  enabled: boolean;
  logic: "all" | "any";
  conditions: RiskCondition[];
  action: {
    severity: Severity;
    openCase: boolean;
    emailOwner: boolean;
  };
  locked?: boolean;
  recommended?: boolean;
  matches: number;
}

export type RiskConditionField = "orders_by_email" | "orders_by_ip" | "gift_card_orders_by_ip" | "emails_by_ip" | "identities_by_phone" | "order_amount" | "order_amount_vs_average" | "gift_card_value" | "payment_failures" | "network_match" | "employee_match" | "refund_after_fulfillment";
export type RiskConditionOperator = "gte" | "gt" | "eq";

export interface RiskCondition {
  id: string;
  field: RiskConditionField;
  operator: RiskConditionOperator;
  value: number | boolean;
  windowMinutes?: number;
}

export interface Employee {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  department: string;
  purchases: number;
  refunded: number;
  risk: Severity;
}

export interface BlacklistReport {
  id: string;
  tenantId: string;
  caseId: string;
  keyType: "email" | "phone" | "address" | "ip" | "customer";
  maskedValue: string;
  reason: string;
  createdAt: string;
  status: "active" | "revoked";
}

export interface DashboardSnapshot {
  tenantId: string;
  cases: FraudCase[];
  stores: Store[];
  employees: Employee[];
  rules: RiskRule[];
  reports: BlacklistReport[];
  notifications: NotificationSettings;
  deliveries: NotificationDelivery[];
  generatedAt: string;
}

export interface NotificationSettings {
  tenantId: string;
  enabled: boolean;
  recipients: string[];
  severities: Severity[];
  reminderMinutes: number;
}

export interface NotificationDelivery {
  id: string;
  tenantId: string;
  caseId: string;
  recipient: string;
  status: "queued" | "sent" | "simulated" | "failed";
  createdAt: string;
  providerId?: string;
}
