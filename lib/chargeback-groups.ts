import type { CrediMatchChargeback } from "@/lib/types";

function identityKeys(item: CrediMatchChargeback): string[] {
  const scope = `${item.tenantId}:${item.match?.storeId ?? "unlinked"}`;
  const emails = [item.match?.confidence === "exact" ? item.match.email : undefined, item.payplus?.status === "found" ? item.payplus.email : undefined];
  const keys = emails.flatMap((value) => {
    const email = value?.trim().toLowerCase();
    return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/^(general|unknown|no-?reply|test)@/.test(email) ? [`${scope}:email:${email}`] : [];
  });
  const phone = item.payplus?.status === "found" ? item.payplus.phone?.replace(/\D/g, "").replace(/^972/, "0") : undefined;
  if (phone && phone.length >= 9) keys.push(`${scope}:phone:${phone}`);
  // Names and last four card digits are not unique identities.
  return keys;
}
export function groupChargebacks(items: CrediMatchChargeback[]) {
  const parents = items.map((_, index) => index);
  const root = (index: number): number => parents[index] === index ? index : (parents[index] = root(parents[index]));
  const seen = new Map<string, number>();
  items.forEach((item, index) => {
    for (const key of identityKeys(item)) {
      const previous = seen.get(key);
      if (previous !== undefined) parents[root(index)] = root(previous);
      else seen.set(key, index);
    }
  });
  const groups = new Map<number, CrediMatchChargeback[]>();
  items.forEach((item, index) => { const key = root(index); const group = groups.get(key) ?? []; group.push(item); groups.set(key, group); });
  return [...groups.values()].map((group) => group.sort((a, b) => (Date.parse(b.creationTime ?? b.receivedAt) || 0) - (Date.parse(a.creationTime ?? a.receivedAt) || 0)));
}
