import { NextResponse } from "next/server";
import { decideCase, getStoreConnection } from "@/lib/operational-store";
import { tagBlockedCustomer } from "@/lib/shopify-admin.server";
import type { CaseStatus } from "@/lib/types";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";

const allowedStatuses = new Set<CaseStatus>(["review", "action", "fraud", "false-positive", "resolved"]);

export async function PATCH(request: Request, context: { params: Promise<{ tenantId: string; caseId: string }> }) {
  await hydrateOperationalState();
  const { tenantId, caseId } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  const status = body && typeof body === "object" && "status" in body ? (body as { status?: unknown }).status : null;
  if (typeof status !== "string" || !allowedStatuses.has(status as CaseStatus)) {
    return NextResponse.json({ error: "INVALID_CASE_STATUS" }, { status: 400 });
  }
  try {
    const item = decideCase(tenantId, caseId, status as CaseStatus);
    let shopifyBlock: "not-needed" | "tagged" | "pending" = "not-needed";
    if (status === "fraud" && item.context?.customerId) {
      try {
        const connection = getStoreConnection(tenantId, item.storeId);
        await tagBlockedCustomer({ shopDomain: connection.store.domain, accessToken: connection.accessToken, customerId: item.context.customerId });
        shopifyBlock = "tagged";
      } catch (blockError) {
        shopifyBlock = "pending";
        console.error("[shopify-block] customer tag pending", { tenantId, caseId, code: blockError instanceof Error ? blockError.message : "TAG_FAILED" });
      }
    }
    await persistOperationalState();
    return NextResponse.json({ case: item, shopifyBlock });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CASE_UPDATE_FAILED";
    return NextResponse.json({ error: message }, { status: message === "CASE_NOT_FOUND" ? 404 : 500 });
  }
}
