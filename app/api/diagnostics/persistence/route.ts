import { NextResponse } from "next/server";
import { hydrateOperationalState } from "@/lib/persistence.server";

export const dynamic = "force-dynamic";

const probe = async (url: string, key: string, id: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(`${url}/rest/v1/shield_ledger_state?id=eq.${id}&select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return `http_${response.status}`;
    const rows = await response.json() as Array<{ id: string }>;
    return rows.length ? "available" : "missing";
  } catch (error) {
    return error instanceof Error && error.name === "AbortError" ? "timeout" : "unavailable";
  } finally {
    clearTimeout(timeout);
  }
};

// This authenticated, value-free probe helps support distinguish a Shopify
// connection issue from a temporary persistence incident. It never returns a
// key, URL, customer data, or encrypted payload.
export async function GET() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.PERSISTENCE_BACKEND !== "supabase" || !url || !key) {
    return NextResponse.json({ backend: process.env.PERSISTENCE_BACKEND ?? "auto", status: "not_configured" });
  }
  const [operational, credimatch] = await Promise.all([probe(url, key, "global"), probe(url, key, "credimatch")]);
  let restore = "skipped";
  if (operational === "available") {
    try {
      await hydrateOperationalState({ refresh: true });
      restore = "available";
    } catch (error) {
      // Error identifiers are intentional here; they reveal configuration or
      // compatibility faults without ever returning encrypted data.
      restore = error instanceof Error ? error.message.slice(0, 100) : "failed";
    }
  }
  return NextResponse.json({ backend: "supabase", operational, credimatch, restore }, { headers: { "Cache-Control": "no-store" } });
}
