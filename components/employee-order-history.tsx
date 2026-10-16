"use client";
import { useEffect, useState } from "react";
import { browserApiFetch } from "@/lib/browser-api-fetch";
import { formatHebrewDateTime } from "@/lib/hebrew-date";

type Order = {
  orderId: string; storeId: string; storeName?: string; storeDomain?: string; orderNumber: string;
  createdAt: string; amount: number; currency: string; email: string; phone: string; address: string; ip: string;
  couponCodes: string[]; giftCardValue: number; status?: string; reason?: string;
  items?: { name: string; quantity: number; price: number }[];
};
const money = (amount: number, currency: string) => {
  try { return new Intl.NumberFormat("he-IL", { style: "currency", currency }).format(amount); }
  catch { return `${amount} ${currency}`; }
};
export function EmployeeOrderHistory({ tenantId, employeeId, couponPrefix }: { tenantId: string; employeeId: string; couponPrefix: string }) {
  const [orders, setOrders] = useState<Order[]>();
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [prefixOnly, setPrefixOnly] = useState(Boolean(couponPrefix.trim()));
  const matchesPrefix = (order: Order) => Boolean(couponPrefix.trim()) && order.couponCodes.some((code) => code.toLowerCase().startsWith(couponPrefix.trim().toLowerCase()));
  useEffect(() => {
    const controller = new AbortController();
    browserApiFetch(`/api/tenants/${encodeURIComponent(tenantId)}/employees/${encodeURIComponent(employeeId)}/orders`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data) => { if (!controller.signal.aborted) setOrders(data.orders); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [tenantId, employeeId]);
  const visible = (orders ?? []).filter((order) => !prefixOnly || matchesPrefix(order)).filter((order) => [order.orderNumber, order.email, ...order.couponCodes].some((value) => value.toLowerCase().includes(query.trim().toLowerCase())));
  return <section className="employee-order-history"><h3>הזמנות העובד {orders ? `(${orders.length})` : ""}</h3><p>{orders ? `${orders.filter(matchesPrefix).length} שימושים בקודי ${couponPrefix || "—"} · מתוך ${orders.length} הזמנות שנקלטו` : "טוען שימושים…"}</p><div className="gift-ledger-tabs" role="group" aria-label="סינון הזמנות העובד"><button aria-pressed={prefixOnly} disabled={!couponPrefix.trim()} onClick={() => { setPrefixOnly(true); setPage(0); }}>קודי {couponPrefix || "עובדים"}</button><button aria-pressed={!prefixOnly} onClick={() => { setPrefixOnly(false); setPage(0); }}>כל ההזמנות</button></div>
    <label className="search-box"><span className="sr-only">חיפוש בהזמנות העובד</span><input placeholder="חיפוש הזמנה, מייל או קוד" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
    {error ? <p role="status">לא ניתן לטעון כרגע. סגור ופתח את הכרטיס לניסיון נוסף.</p> : !orders ? <p role="status">טוען הזמנות…</p> : !visible.length ? <p>לא נמצאו הזמנות תואמות במידע שנשמר.</p> : visible.slice(page * 10, page * 10 + 10).map((order) => {
      const id = order.orderId.match(/\d+$/)?.[0];
      return <details className="employee-history-order" key={`${order.storeId}:${order.orderId}`}><summary><strong>#{order.orderNumber.replace(/^#/, "")}</strong><time>{Number.isFinite(Date.parse(order.createdAt)) ? formatHebrewDateTime(order.createdAt) : "מועד לא התקבל"}</time><strong>{money(order.amount, order.currency)}</strong><small><bdi>{order.couponCodes.filter((code) => code.toLowerCase().startsWith(couponPrefix.trim().toLowerCase())).join(", ")}</bdi> · {order.status === "fraud" ? "אושרה כהונאה" : ["resolved", "false-positive"].includes(order.status ?? "") ? "טופלה" : order.status ? "קיימת התראה" : "ללא התראה"}</small></summary>
        <dl className="employee-history-facts"><div><dt>חנות</dt><dd>{order.storeName ?? "—"}</dd></div><div><dt>אימייל</dt><dd><bdi>{order.email || "לא התקבל"}</bdi></dd></div><div><dt>טלפון</dt><dd><bdi>{order.phone || "לא התקבל"}</bdi></dd></div><div><dt>כתובת</dt><dd>{order.address || "לא התקבלה"}</dd></div><div><dt>IP</dt><dd><bdi>{order.ip || "לא התקבל"}</bdi></dd></div><div><dt>קודי הנחה</dt><dd>{order.couponCodes.join(", ") || "ללא קוד"}</dd></div>{order.giftCardValue > 0 ? <div><dt>רכישת גיפטקארד</dt><dd>{money(order.giftCardValue, order.currency)}</dd></div> : null}{order.reason ? <div><dt>סיבת התראה</dt><dd>{order.reason}</dd></div> : null}</dl>
        {order.items?.length ? <ul>{order.items.map((item, index) => <li key={index}>{item.quantity} × {item.name} · {money(item.quantity * item.price, order.currency)}</li>)}</ul> : <p>פירוט הפריטים לא נשמר להזמנה זו. אפשר לראותו ב־Shopify.</p>}
        {order.storeDomain && id ? <a className="secondary-button" href={`https://${order.storeDomain}/admin/orders/${id}`} target="_blank" rel="noreferrer">פתיחת ההזמנה ב־Shopify</a> : null}
      </details>;
    })}
    {visible.length > 10 ? <div className="employee-history-pagination"><button type="button" className="secondary-button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>הקודם</button><span>עמוד {page + 1} מתוך {Math.ceil(visible.length / 10)}</span><button type="button" className="secondary-button" disabled={(page + 1) * 10 >= visible.length} onClick={() => setPage((value) => value + 1)}>הבא</button></div> : null}
  </section>;
}
