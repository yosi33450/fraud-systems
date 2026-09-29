import { NextResponse } from "next/server";
import { CrediMatchApiError, CrediMatchConfigurationError, getCrediMatchDiscrepancy, getCrediMatchTransaction } from "@/lib/credimatch.server";
import { crediMatchTransactionIds } from "@/lib/credimatch-matching";
import { CrediMatchWebhookValidationError, parseCrediMatchWebhook } from "@/lib/credimatch-webhook";
import { recordCrediMatchDiscrepancy } from "@/lib/operational-store";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 64_000;

const responseShape = (payload: unknown) => {
  if (Array.isArray(payload)) return { type: "array", count: payload.length };
  if (payload && typeof payload === "object") return { type: "object", keys: Object.keys(payload).slice(0, 20) };
  return { type: typeof payload };
};

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "WEBHOOK_PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
      return NextResponse.json({ error: "WEBHOOK_PAYLOAD_TOO_LARGE" }, { status: 413 });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new CrediMatchWebhookValidationError("CREDIMATCH_WEBHOOK_JSON_INVALID");
    }
    const { discrepancyIds, ignoredEvents } = parseCrediMatchWebhook(payload);
    if (discrepancyIds.length === 0) {
      return NextResponse.json({ accepted: true, processed: 0, duplicates: 0, ignoredEvents }, { status: 202 });
    }

    await hydrateOperationalState();
    let duplicates = 0;
    for (const discrepancyId of discrepancyIds) {
      const discrepancy = await getCrediMatchDiscrepancy(discrepancyId);
      const transactions = await Promise.all(crediMatchTransactionIds(discrepancy).map((transactionId) => getCrediMatchTransaction(transactionId)));
      const result = recordCrediMatchDiscrepancy(discrepancyId, discrepancy, transactions);
      if (result.duplicate) duplicates += 1;
      console.info("[credimatch-webhook] discrepancy received", { discrepancyId, duplicate: result.duplicate, transactions: transactions.length, response: responseShape(discrepancy) });
    }
    await persistOperationalState();
    return NextResponse.json({ accepted: true, processed: discrepancyIds.length - duplicates, duplicates, ignoredEvents }, { status: 202 });
  } catch (error) {
    if (error instanceof CrediMatchWebhookValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof CrediMatchConfigurationError) {
      console.error("[credimatch-webhook] configuration error", { code: error.message });
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof CrediMatchApiError) {
      console.error("[credimatch-webhook] API request failed", { code: error.message, status: error.status });
      return NextResponse.json({ error: "CREDIMATCH_UPSTREAM_FAILED" }, { status: 502 });
    }
    const message = error instanceof Error ? error.message : "CREDIMATCH_WEBHOOK_FAILED";
    console.error("[credimatch-webhook] processing failed", { code: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
