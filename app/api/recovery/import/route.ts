import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDashboardSnapshot, restoreOperationalState } from "@/lib/operational-store";
import { decryptPrivateData, persistOperationalState } from "@/lib/persistence.server";

const maxChunkLength = 3_500_000;

const configuration = () => {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
};

const authorized = (provided: string | null, expected = process.env.RECOVERY_IMPORT_TOKEN) => {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

const headers = (key: string) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
});

type Chunk = { index: number; total: number; content: string };
type ImportRequest = Chunk | { complete: true; total: number };

export async function POST(request: Request) {
  if (!authorized(request.headers.get("x-recovery-token"))) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const config = configuration();
  if (!config) return NextResponse.json({ error: "RECOVERY_STORAGE_NOT_CONFIGURED" }, { status: 503 });
  const body = await request.json().catch(() => null) as ImportRequest | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "INVALID_RECOVERY_PAYLOAD" }, { status: 400 });
  try {
    if ("complete" in body) {
      if (!Number.isInteger(body.total) || body.total < 1 || body.total > 20) {
        return NextResponse.json({ error: "INVALID_RECOVERY_TOTAL" }, { status: 400 });
      }
      const response = await fetch(`${config.url}/rest/v1/shield_recovery_chunks?select=id,content&order=id.asc`, {
        headers: headers(config.key), cache: "no-store",
      });
      if (!response.ok) throw new Error(`RECOVERY_READ_FAILED_${response.status}`);
      const chunks = await response.json() as Array<{ id: number; content: string }>;
      if (chunks.length !== body.total || chunks.some((chunk, index) => chunk.id !== index + 1)) {
        return NextResponse.json({ error: "RECOVERY_CHUNKS_INCOMPLETE" }, { status: 409 });
      }
      const encrypted = JSON.parse(chunks.map((chunk) => chunk.content).join(""));
      restoreOperationalState(decryptPrivateData(encrypted));
      await persistOperationalState();
      await fetch(`${config.url}/rest/v1/shield_recovery_chunks?id=gt.0`, {
        method: "DELETE", headers: headers(config.key), cache: "no-store",
      });
      const snapshot = getDashboardSnapshot("tenant-primary");
      return NextResponse.json({ ok: true, stores: snapshot.stores.length, cases: snapshot.cases.length });
    }
    if (!Number.isInteger(body.index) || !Number.isInteger(body.total) || body.index < 1 || body.index > body.total || body.total > 20 || typeof body.content !== "string" || body.content.length > maxChunkLength) {
      return NextResponse.json({ error: "INVALID_RECOVERY_CHUNK" }, { status: 400 });
    }
    const response = await fetch(`${config.url}/rest/v1/shield_recovery_chunks`, {
      method: "POST",
      headers: { ...headers(config.key), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: body.index, content: body.content }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`RECOVERY_WRITE_FAILED_${response.status}`);
    return NextResponse.json({ ok: true, received: body.index, total: body.total });
  } catch (error) {
    return NextResponse.json({
      error: "RECOVERY_IMPORT_FAILED",
      detail: error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN",
    }, { status: 422 });
  }
}
