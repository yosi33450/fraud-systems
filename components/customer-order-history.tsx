"use client";
import { useEffect, useState } from "react";
import { browserApiFetch } from "@/lib/browser-api-fetch";
import { formatHebrewDateTime } from "@/lib/hebrew-date";
import { inLastWeek } from "@/lib/activity-scope";

type HistoryOrder = { orderId: string; orderNumber: string; createdAt: string; amount: number; currency: string; status?: string };
export function CustomerOrderHistory({ tenantId, caseId, storeDomain }: { tenantId: string; caseId: string; storeDomain?: string }) {
  const [orders, setOrders] = useState<HistoryOrder[]>();
  const [error, setError] = useState(false);
  const [limit, setLimit] = useState(10);
  useEffect(() => {
    const controller = new AbortController();
    browserApiFetch(`/api/tenants/${encodeURIComponent(tenantId)}/cases/${encodeURIComponent(caseId)}/customer-history`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data) => { if (!controller.signal.aborted) setOrders(data.orders); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [tenantId, caseId]);
  return <details className="customer-order-history"><summary>היסטוריית רכישות הלקוח {orders ? `(${orders.length})` : ""}</summary>
    <p>כל ההזמנות שנשמרו במערכת, גם מהארכיון וגם ללא התראה.</p>
    {error ? <p role="status">לא ניתן לטעון את ההיסטוריה כרגע. סגור ופתח את הכרטיס לניסיון נוסף.</p> : !orders ? <p role="status">טוען היסטוריה…</p> : <>
      <div className="customer-history-list">{orders.slice(0, limit).map((order) => {
        const numericId = order.orderId.match(/\d+$/)?.[0];
        return <article key={order.orderId}><div><strong>{order.orderNumber}</strong><small>{order.status === "fraud" ? "אושרה כהונאה" : order.status === "resolved" || order.status === "false-positive" ? "טופלה" : order.status ? "קיימת התראה" : "ללא התראה"}{!inLastWeek(order.createdAt) ? " · מהארכיון" : ""}</small></div><time>{order.createdAt ? formatHebrewDateTime(order.createdAt) : "מועד לא התקבל"}</time><strong>{new Intl.NumberFormat("he-IL", { style: "currency", currency: order.currency }).format(order.amount)}</strong>{storeDomain && numericId ? <a href={`https://${storeDomain}/admin/orders/${numericId}`} target="_blank" rel="noreferrer">פתח ב־Shopify</a> : null}</article>;
      })}</div>{orders.length > limit ? <button className="secondary-button" onClick={() => setLimit((value) => value + 10)}>הצג עוד הזמנות</button> : null}
    </>}
  </details>;
}
