import { rules as defaultRules } from "@/lib/initial-state";
import type { Evidence, RiskCondition, RiskRule, Severity } from "@/lib/types";
import { velocityDefaults, velocityKey } from "@/lib/order-velocity";

export interface OrderSignals {
  conditionValues?: Record<string, number>;
  ordersByEmailLastHour: number;
  ordersByIpLastTwoHours: number;
  giftCardOrdersByIpLastTwoHours: number;
  emailsByIpLastTwoHours: number;
  identitiesByPhoneLastDay: number;
  orderAmount: number;
  averageOrderValue: number;
  giftCardValue: number;
  giftCardBaseline: number;
  linkedGiftCard: boolean;
  paymentFailures: number;
  billingShippingMismatch: boolean;
  shopifyRisk: "none" | "low" | "medium" | "high";
  shopifyRiskFacts?: string[];
  orderLocalHour?: number;
  employeeMatch: boolean;
  refundAfterFulfillment: boolean;
  blacklist: { email: boolean; phone: boolean; address: boolean; ip: boolean; customer: boolean };
}

export interface RiskResult {
  score: number;
  severity: Severity;
  evidence: Evidence[];
  matchedRuleIds: string[];
  version: "2026.09-v3";
}

const severityRank: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const baseScore: Record<Severity, number> = { low: 18, medium: 45, high: 72, critical: 92 };

const signalValue = (condition: RiskCondition, signals: OrderSignals): number | boolean => {
  if (condition.field in velocityDefaults) {
    const minutes = condition.windowMinutes ?? velocityDefaults[condition.field];
    if (signals.conditionValues) return signals.conditionValues[velocityKey(condition.field, minutes, condition.minGiftCardValue)] ?? 0;
    // Legacy/API signals are only valid for their explicitly named fixed window.
    if (minutes !== velocityDefaults[condition.field]) return 0;
  }
  switch (condition.field) {
    case "orders_by_email": return signals.ordersByEmailLastHour;
    case "orders_by_ip": return signals.ordersByIpLastTwoHours;
    case "orders_by_phone": return 0;
    case "gift_card_orders_by_ip": return signals.giftCardOrdersByIpLastTwoHours;
    case "gift_card_orders_by_email": return 0;
    case "gift_card_orders_by_phone": return 0;
    case "emails_by_ip": return signals.emailsByIpLastTwoHours;
    case "identities_by_phone": return signals.identitiesByPhoneLastDay;
    case "order_amount": return signals.orderAmount;
    case "order_amount_vs_average": return signals.averageOrderValue > 0 ? signals.orderAmount / signals.averageOrderValue : 0;
    case "gift_card_value": return signals.giftCardValue;
    case "linked_gift_card": return signals.linkedGiftCard;
    case "payment_failures": return signals.paymentFailures;
    case "network_match": return signals.blacklist.email || signals.blacklist.phone || signals.blacklist.address || signals.blacklist.ip || signals.blacklist.customer;
    case "employee_match": return signals.employeeMatch;
    case "refund_after_fulfillment": return signals.refundAfterFulfillment;
    case "billing_shipping_mismatch": return signals.billingShippingMismatch;
    case "order_local_hour": return signals.orderLocalHour ?? -1;
  }
};

const conditionMatches = (condition: RiskCondition, signals: OrderSignals) => {
  const actual = signalValue(condition, signals);
  if (condition.field === "order_local_hour") {
    const start = condition.startHour ?? 0;
    const end = condition.endHour ?? 5;
    return typeof actual === "number" && actual >= 0 && (start < end ? actual >= start && actual < end : actual >= start || actual < end);
  }
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
  const alertRules = matched.filter((rule) => rule.action.openCase);
  const evidence: Evidence[] = alertRules.map((rule, index) => ({
    id: `${index + 1}`,
    label: rule.label,
    description: rule.conditions.map((condition) => {
      const actual = signalValue(condition, signals);
      if (condition.field in velocityDefaults) {
        const minutes = condition.windowMinutes ?? velocityDefaults[condition.field];
        const subject = condition.field === "orders_by_email" ? "הזמנות מאותו אימייל" : condition.field === "orders_by_ip" ? "הזמנות מאותה כתובת IP" : condition.field === "orders_by_phone" ? "הזמנות מאותו טלפון" : condition.field === "gift_card_orders_by_ip" ? "רכישות גיפטקארד מאותה כתובת IP" : condition.field === "gift_card_orders_by_email" ? "רכישות גיפטקארד מאותו אימייל" : condition.field === "gift_card_orders_by_phone" ? "רכישות גיפטקארד מאותו טלפון" : condition.field === "emails_by_ip" ? "אימיילים שונים מאותה כתובת IP" : "אימיילים שונים לאותו טלפון";
        return `נמצאו ${actual} ${subject} ב־${minutes} הדקות שעד ההזמנה, כולל ההזמנה הנוכחית. הסף: ${condition.operator === "gt" ? "יותר מ־" : condition.operator === "eq" ? "בדיוק " : "לפחות "}${condition.value}.`;
      }
      if (condition.field === "order_amount") return `סכום הרכישה הבודדת: ${actual}. הסף: ${condition.operator === "gt" ? "מעל " : condition.operator === "eq" ? "בדיוק " : "לפחות "}${condition.value}.`;
      if (condition.field === "order_local_hour") return `ההזמנה התקבלה בין ${String(condition.startHour ?? 0).padStart(2, "0")}:00 ל־${String(condition.endHour ?? 5).padStart(2, "0")}:00 לפי שעון ישראל.`;
      return rule.description || "התנאי התקיים.";
    }).join(" "),
    source: sourceFor(rule),
    delta: baseScore[rule.action.severity],
    timestamp: now.toISOString(),
  }));

  if (signals.shopifyRisk === "high") {
    evidence.push({ id: `${evidence.length + 1}`, label: "Shopify סימנה סיכון גבוה", description: signals.shopifyRiskFacts?.length ? `סיבות מ־Shopify: ${signals.shopifyRiskFacts.join("; ")}` : "מנגנון הסיכון של Shopify המליץ לבדוק את ההזמנה.", source: "shopify", delta: 70, timestamp: now.toISOString() });
  }
  if (signals.shopifyRisk === "medium") {
    evidence.push({ id: `${evidence.length + 1}`, label: "Shopify סימנה סיכון בינוני", description: signals.shopifyRiskFacts?.length ? `סיבות מ־Shopify: ${signals.shopifyRiskFacts.join("; ")}` : "מנגנון הסיכון של Shopify המליץ לבדוק את ההזמנה.", source: "shopify", delta: 8, timestamp: now.toISOString() });
  }
  if (signals.billingShippingMismatch) {
    evidence.push({ id: `${evidence.length + 1}`, label: "כתובות החיוב והמשלוח שונות", description: "זהו סימן משלים לבדיקה, לא הוכחה להונאה.", source: "behavior", delta: 18, timestamp: now.toISOString() });
  }
  if (alertRules.length || signals.shopifyRisk === "high") for (const rule of matched.filter((candidate) => !candidate.action.openCase)) {
    evidence.push({ id: `${evidence.length + 1}`, label: rule.label, description: rule.conditions.map((condition) => condition.field === "order_local_hour" ? `שעת הרכישה ${String(signals.orderLocalHour).padStart(2, "0")}:00 בתוך החלון ${String(condition.startHour ?? 0).padStart(2, "0")}:00–${String(condition.endHour ?? 5).padStart(2, "0")}:00 (ישראל).` : rule.description).join(" "), source: "behavior", delta: rule.action.scoreBonus ?? 0, timestamp: now.toISOString() });
  }

  const ruleSeverity = alertRules.reduce<Severity>((highest, rule) => severityRank[rule.action.severity] > severityRank[highest] ? rule.action.severity : highest, "low");
  const shopifySeverity: Severity = signals.shopifyRisk === "high" ? "high" : "low";
  const severity = severityRank[shopifySeverity] > severityRank[ruleSeverity] ? shopifySeverity : ruleSeverity;
  const bonus = matched.filter((rule) => !rule.action.openCase).reduce((sum, rule) => sum + Math.max(0, Math.min(20, rule.action.scoreBonus ?? 0)), 0);
  const hasPrimaryAlert = alertRules.length > 0 || signals.shopifyRisk === "high";
  const score = hasPrimaryAlert
    ? Math.min(100, baseScore[severity] + Math.max(0, evidence.length - 1) * 2 + bonus + (signals.shopifyRisk === "medium" ? 8 : 0))
    : Math.min(24, bonus + (signals.shopifyRisk === "medium" ? 8 : 0) + (signals.billingShippingMismatch ? 2 : 0));

  return { score, severity, evidence, matchedRuleIds: matched.map((rule) => rule.id), version: "2026.09-v3" };
}
