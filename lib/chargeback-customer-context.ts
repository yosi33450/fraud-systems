import type { CrediMatchChargeback } from "@/lib/types";

export function chargebackCustomerKey(item: CrediMatchChargeback) {
  if (item.match?.confidence !== "exact" || !item.match.storeId) return undefined;
  const email = item.match.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || /^(?:general|unknown|no-?reply|test)@/i.test(email)) return undefined;
  return `${item.match.storeId}:${email}`;
}

export function relatedCustomerChargebacks(item: CrediMatchChargeback, all: CrediMatchChargeback[]) {
  const key = chargebackCustomerKey(item);
  if (!key) return [];
  return all.filter((candidate) => candidate.id !== item.id && chargebackCustomerKey(candidate) === key)
    .sort((left, right) => Date.parse(right.creationTime ?? right.receivedAt) - Date.parse(left.creationTime ?? left.receivedAt));
}
