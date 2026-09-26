import { NextResponse } from "next/server";
import { releaseBlacklistCase } from "@/lib/operational-store";
import { getFreshStoreConnection } from "@/lib/shopify-connection.server";
import { untagBlockedCustomer } from "@/lib/shopify-admin.server";
import { hydrateOperationalState, persistOperationalState } from "@/lib/persistence.server";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ tenantId: string; caseId: string }> }) {
  await hydrateOperationalState();
  const { tenantId, caseId } = await context.params;
  try {
    const result = releaseBlacklistCase(tenantId, caseId);
    let shopifyRelease: "not-needed" | "released" | "pending" = "not-needed";
    if (result.case.context?.customerId) {
      try {
        const connection = await getFreshStoreConnection(tenantId, result.case.storeId);
        await untagBlockedCustomer({ shopDomain: connection.store.domain, accessToken: connection.accessToken, customerId: result.case.context.customerId });
        shopifyRelease = "released";
      } catch (releaseError) {
        shopifyRelease = "pending";
        console.error("[shopify-block] customer untag pending", { tenantId, caseId, code: releaseError instanceof Error ? releaseError.message : "UNTAG_FAILED" });
      }
    }
    await persistOperationalState();
    return NextResponse.json({ released: true, releasedIdentifiers: result.released, shopifyRelease });
  } catch (error) {
    const message = error instanceof Error ? error.message : "BLOCK_RELEASE_FAILED";
    return NextResponse.json({ released: false, error: message }, { status: message === "CASE_NOT_FOUND" ? 404 : 500 });
  }
}
