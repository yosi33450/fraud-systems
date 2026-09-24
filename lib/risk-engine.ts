import { rules as defaultRules } from "@/lib/initial-state";
import type { Evidence, RiskCondition, RiskRule, Severity } from "@/lib/types";

export interface OrderSignals {
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
}

export interface RiskResult {
  score: number;
  severity: Severity;
  evidence: Evidence[];
  matchedRuleIds: string[];
  version: "2026.09-v2";
}

const severityRank: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const baseScore: Record<Severity, number> = { low: 18, medium: 45, high: 72, critical: 92 };

const signalValue = (condition: RiskCondition, signals: OrderSignals): number | boolean => {
  switch (condition.field) {
    case "orders_by_email": return signals.ordersByEmailLastHour;
    case "orders_by_ip": return signals.ordersByIpLastTwoHours;
    case "gift_card_orders_by_ip": return signals.giftCardOrdersByIpLastTwoHours;
    case "emails_by_ip": return signals.emailsByIpLastTwoHours;
    case "identities_by_phone": return signals.identitiesByPhoneLastDay;
    case "order_amount": return signals.orderAmount;
    case "order_amount_vs_average": return signals.averageOrderValue > 0 ? signals.orderAmount / signals.averageOrderValue : 0;
    case "gift_card_value": return signals.giftCardValue;
    case "payment_failures": return signals.paymentFailures;
    case "network_match": return signals.blacklist.email || signals.blacklist.phone || signals.blacklist.address || signals.blacklist.ip || signals.blacklist.customer;
    case "employee_match": return signals.employeeMatch;
    case "refund_after_fulfillment": return signals.refundAfterFulfillment;
  }
};

const conditionMatches = (condition: RiskCondition, signals: OrderSignals) => {
  const actual = signalValue(condition, signals);
  if (condition.operator === "eq") return actual === condition.value;
  if (typeof actual !== "number" || typeof condition.value !== "number") return false;
  return condition.operator === "gt" ? actual > condition.value : actual >= condition.value;
};

const ruleMatches = (rule: RiskRule, signals: OrderSignals) => {
  const results = rule.conditions.map((condition) => conditionMatches(condition, signals));
  return rule.logic === "all" ? results.every(Boolean) : results.some(Boolean);
};

const sourceFor = (rule: RiskRule): Evidence["source"] => rule.category === "network" ? "network" : rule.category === "employee" ? "employee" : "behavior";

export function evaluateRisk(signals: OrderSignals, now = new Date(), rules: RiskRule[] = defaultRules): RiskResult {
  const matched = rules.filter((rule) => rule.enabled && rule.conditions.length > 0 && ruleMatches(rule, signals));
  const evidence: Evidence[] = matched.map((rule, index) => ({
    id: `${index + 1}`,
    label: rule.label,
    description: rule.description || `${rule.conditions.length} תנאים בחוק התקיימו.`,
    source: sourceFor(rule),
    delta: baseScore[rule.action.severity],
    timestamp: now.toISOString(),
  }));

  if (signals.shopifyRisk === "high") {
    evidence.push({ id: `${evidence.length + 1}`, label: "Shopify סימנה סיכון גבוה", description: "מנגנון הסיכון של Shopify המליץ לבדוק את ההזמנה.", source: "shopify", delta: 70, timestamp: now.toISOString() });
  }
  if (signals.billingShippingMismatch) {
    evidence.push({ id: `${evidence.length + 1}`, label: "כתובות החיוב והמשלוח שונות", description: "זהו סימן משלים לבדיקה, לא הוכחה להונאה.", source: "behavior", delta: 18, timestamp: now.toISOString() });
  }

  const ruleSeverity = matched.reduce<Severity>((highest, rule) => severityRank[rule.action.severity] > severityRank[highest] ? rule.action.severity : highest, "low");
  const shopifySeverity: Severity = signals.shopifyRisk === "high" ? "high" : "low";
  const severity = severityRank[shopifySeverity] > severityRank[ruleSeverity] ? shopifySeverity : ruleSeverity;
  const score = evidence.length === 0 ? 0 : Math.min(100, baseScore[severity] + Math.max(0, evidence.length - 1) * 2);

  return { score, severity, evidence, matchedRuleIds: matched.map((rule) => rule.id), version: "2026.09-v2" };
}
