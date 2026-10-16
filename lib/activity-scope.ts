import type { CrediMatchChargeback, FraudCase } from "./types";

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export function timestamp(value?: string): number {
  // Never let JS reinterpret a legacy Hebrew DD.MM.YYYY label as US MM.DD.YYYY.
  const parsed = value && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
export function inLastWeek(value?: string, now = Date.now()): boolean {
  const time = timestamp(value);
  return time > 0 && time >= now - WEEK_MS && time <= now;
}
export function caseDate(item: FraudCase): string | undefined {
  return [item.occurredAt, item.createdAt, ...item.evidence.map((entry) => entry.timestamp)].find((value) => timestamp(value) > 0);
}
export function isCurrentCase(item: FraudCase, now = Date.now()): boolean {
  return ["new", "review", "action"].includes(item.status) && inLastWeek(caseDate(item), now);
}
export function chargebackDate(item: CrediMatchChargeback): string {
  return timestamp(item.creationTime) ? item.creationTime! : item.receivedAt;
}
