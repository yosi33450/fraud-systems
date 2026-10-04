import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getDashboardSnapshot, restoreOperationalState } from "@/lib/operational-store";
import { decryptPrivateData, persistOperationalState } from "@/lib/persistence.server";

// This route is deliberately input-free: it can only restore the encrypted
// recovery object uploaded by the owner to this project's private Blob store.
// It is removed immediately after the one-time recovery is verified.
const recoveryPath = "private/recovery/velocity-backup.enc.json";

export async function POST() {
  if (process.env.PERSISTENCE_BACKEND !== "blob") {
    return NextResponse.json({ error: "RECOVERY_BACKEND_NOT_ACTIVE" }, { status: 409 });
  }
  try {
    const backup = await get(recoveryPath, { access: "private", useCache: false });
    if (!backup || backup.statusCode !== 200 || !backup.stream) {
      return NextResponse.json({ error: "RECOVERY_BACKUP_NOT_FOUND" }, { status: 404 });
    }
    const encrypted = JSON.parse(await new Response(backup.stream).text());
    restoreOperationalState(decryptPrivateData(encrypted));
    await persistOperationalState();
    const snapshot = getDashboardSnapshot("tenant-primary");
    return NextResponse.json({
      ok: true,
      stores: snapshot.stores.length,
      cases: snapshot.cases.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({
      error: "RECOVERY_IMPORT_FAILED",
      detail: error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN",
    }, { status: 422 });
  }
}
