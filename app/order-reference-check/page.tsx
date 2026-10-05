import { GET } from "@/app/api/credimatch/order-probe/route";

export const dynamic = "force-dynamic";

export default async function OrderReferenceCheck({ searchParams }: {
  searchParams: Promise<{ orderId?: string; discrepancyId?: string }>;
}) {
  const { orderId, discrepancyId } = await searchParams;
  const url = new URL("https://fraud-systems.vercel.app/api/credimatch/order-probe");
  if (orderId) url.searchParams.set("orderId", orderId);
  if (discrepancyId) url.searchParams.set("discrepancyId", discrepancyId);
  const response = await GET(new Request(url));
  const result: unknown = await response.json();
  return <main style={{ margin: "2rem", fontFamily: "monospace", whiteSpace: "pre-wrap", direction: "ltr" }}>
    <h1>Order reference check</h1>
    <pre>{JSON.stringify(result, null, 2)}</pre>
  </main>;
}
