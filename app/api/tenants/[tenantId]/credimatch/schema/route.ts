import { NextResponse } from "next/server";
import { getCrediMatchTransaction } from "@/lib/credimatch.server";
import { hydrateCrediMatchChargebacks } from "@/lib/credimatch-persistence.server";
import { exportCrediMatchChargebacks } from "@/lib/operational-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Shape = { type: string; count?: number; fields?: Record<string, Shape>; item?: Shape };

function responseShape(value: unknown, depth = 0): Shape {
  if (depth >= 4) return { type: Array.isArray(value) ? "array" : typeof value };
  if (Array.isArray(value)) {
    return { type: "array", count: value.length, item: value.length ? responseShape(value[0], depth + 1) : undefined };
  }
  if (value && typeof value === "object") {
    return {
      type: "object",
      fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 80)
        .map(([key, entry]) => [key, responseShape(entry, depth + 1)])),
    };
  }
  return { type: value === null ? "null" : typeof value };
}

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await context.params;
  try {
    await hydrateCrediMatchChargebacks();
    const chargeback = exportCrediMatchChargebacks().find((item) => item.tenantId === tenantId && item.transactionId);
    if (!chargeback?.transactionId) {
      return NextResponse.json({ error: "CREDIMATCH_TRANSACTION_NOT_FOUND" }, { status: 404 });
    }
    const payload = await getCrediMatchTransaction(chargeback.transactionId);
    return NextResponse.json({ transactionShape: responseShape(payload) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CREDIMATCH_SCHEMA_FAILED";
    console.error("[credimatch-schema] failed", { tenantId, code: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
