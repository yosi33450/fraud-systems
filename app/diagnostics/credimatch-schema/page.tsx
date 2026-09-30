import { getCrediMatchTransaction } from "@/lib/credimatch.server";
import { hydrateCrediMatchChargebacks } from "@/lib/credimatch-persistence.server";
import { exportCrediMatchChargebacks } from "@/lib/operational-store";

export const dynamic = "force-dynamic";

function shape(value: unknown, depth = 0): unknown {
  if (depth >= 4) return { type: Array.isArray(value) ? "array" : typeof value };
  if (Array.isArray(value)) return { type: "array", count: value.length, item: value.length ? shape(value[0], depth + 1) : undefined };
  if (value && typeof value === "object") {
    return {
      type: "object",
      fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 80)
        .map(([key, entry]) => [key, shape(entry, depth + 1)])),
    };
  }
  return { type: value === null ? "null" : typeof value };
}

export default async function CrediMatchSchemaDiagnostic() {
  await hydrateCrediMatchChargebacks();
  const chargeback = exportCrediMatchChargebacks().find((item) => item.tenantId === "tenant-primary" && item.transactionId);
  const result = chargeback?.transactionId
    ? shape(await getCrediMatchTransaction(chargeback.transactionId))
    : { error: "CREDIMATCH_TRANSACTION_NOT_FOUND" };
  return <main dir="rtl" style={{ padding: 24, fontFamily: "sans-serif" }}>
    <h1>מבנה תגובת עסקה מ־CrediMatch</h1>
    <p>מוצגים שמות שדות וסוגי נתונים בלבד. ערכי העסקה אינם מוצגים.</p>
    <pre dir="ltr" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(result, null, 2)}</pre>
  </main>;
}
