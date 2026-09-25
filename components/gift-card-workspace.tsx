"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ExternalLink, Gift, Link2, RefreshCcw, Search, ShieldCheck, X } from "lucide-react";
import { CenteredDialog } from "@/components/centered-dialog";
import type { GiftLedger, GiftLedgerCard } from "@/lib/gift-card-evidence";
import type { FraudCase, Store } from "@/lib/types";

const money = (amount: number, currency: string) => new Intl.NumberFormat("he-IL", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
const date = (value: string) => new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const numericId = (id: string) => id.split("/").at(-1) ?? id;
const empty: GiftLedger = { cards: [], orders: [] };
type Route = { key: string; storeId: string; order: GiftLedgerCard["uses"][number]["order"]; currency: string; amount: number; cards: GiftLedgerCard[] };

export function GiftCardWorkspace({ ledger = empty, stores, cases, onOpenCase, onRefresh }: {
  ledger?: GiftLedger; stores: Store[]; cases: FraudCase[]; onOpenCase: (item: FraudCase) => void; onRefresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [storeId, setStoreId] = useState("all");
  const [tab, setTab] = useState<"routes" | "cards">("routes");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(30);
  const [mode, setMode] = useState("all");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const stopped = useRef(false);
  const refreshRef = useRef(onRefresh);
  useEffect(() => { refreshRef.current = onRefresh; }, [onRefresh]);
  useEffect(() => {
    stopped.current = false;
    const order = new URLSearchParams(window.location.search).get("order");
    if (order) setQuery(order);
    return () => { stopped.current = true; };
  }, []);
  useEffect(() => {
    if (scanning) return;
    let refreshing = false;
    const interval = window.setInterval(async () => {
      if (refreshing || document.visibilityState !== "visible") return;
      refreshing = true;
      try { await refreshRef.current(); } finally { refreshing = false; }
    }, 30000);
    return () => window.clearInterval(interval);
  }, [scanning]);
  const scoped = ledger.cards.filter((card) => storeId === "all" || card.storeId === storeId);
  const orders = ledger.orders.filter((order) => storeId === "all" || order.storeId === storeId);
  const needle = query.trim().toLowerCase();
  const cards = scoped.filter((card) => !needle || [card.giftCardId, card.lastCharacters, card.purchase?.orderNumber, card.purchase?.customer, card.purchase?.email,
    ...card.uses.flatMap((use) => [use.order.orderNumber, use.order.customer, use.order.email])].some((value) => value?.toLowerCase().includes(needle)));
  const routes = useMemo(() => {
    const grouped = new Map<string, Route>();
    for (const card of cards) for (const use of card.uses.filter((entry) => entry.kind !== "REFUND")) {
      const key = `${card.storeId}:${use.order.orderId}:${use.currency}`;
      let route = grouped.get(key);
      if (!route) { route = { key, storeId: card.storeId, order: use.order, currency: use.currency, amount: 0, cards: [] }; grouped.set(key, route); }
      route.amount += use.amount;
      if (!route.cards.some((entry) => entry.key === card.key)) route.cards.push(card);
    }
    return [...grouped.values()].sort((a, b) => b.cards.length - a.cards.length);
  }, [cards]);
  const exactCount = scoped.filter((card) => card.purchase && !card.purchaseConflict && card.uses.some((use) => use.kind !== "REFUND")).length;
  const missing = scoped.filter((card) => !card.purchase || card.purchaseConflict).length;
  const pending = orders.reduce((sum, order) => sum + Math.max(0, order.giftCardUnits - order.issued.length) + order.unidentifiedTransactions, 0);
  const lastChecked = orders.map((order) => order.checkedAt).sort().at(-1);

  async function scan() {
    stopped.current = false; setScanning(true); setError("");
    let total = 0;
    try {
      const until = new Date().toISOString();
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      for (const store of stores.filter((item) => storeId === "all" || item.id === storeId)) {
        let after: string | null = null;
        do {
          if (stopped.current) break;
          setProgress(`${store.name} · נבדקו ${total.toLocaleString("he-IL")} הזמנות`);
          const requestPage = () => fetch(`/api/tenants/${encodeURIComponent(store.tenantId)}/stores/${encodeURIComponent(store.id)}/gift-cards`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, after, since, until }),
          });
          let response: Response = await requestPage();
          for (let retry = 0; response.status >= 500 && retry < 2 && !stopped.current; retry++) {
            await new Promise((resolve) => setTimeout(resolve, 1500 * (retry + 1)));
            if (stopped.current) break;
            response = await requestPage();
          }
          const result: { scanned: number; after: string | null; liveSetup: boolean; error?: string } = await response.json();
          if (!response.ok) throw new Error(result.error || "הסריקה לא הושלמה");
          total += result.scanned; after = result.after;
          if (!result.liveSetup) setError("הסריקה פועלת, אך עדכון החיבור לקליטה שוטפת לא הצליח. יש לבדוק את חיבור החנות.");
        } while (after && !stopped.current);
        if (stopped.current) break;
      }
      setProgress(`${stopped.current ? "הסריקה נעצרה" : "הסריקה הושלמה"} · נבדקו ${total.toLocaleString("he-IL")} הזמנות. הראיות שנמצאו נשמרו.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "הסריקה לא הושלמה"); }
    finally { setScanning(false); await onRefresh(); }
  }
  const storeFor = (id: string) => stores.find((store) => store.id === id);
  const orderLink = (id: string, orderId: string) => `https://${storeFor(id)?.domain}/admin/orders/${numericId(orderId)}`;
  const caseFor = (id: string, orderId: string) => cases.find((item) => item.storeId === id && item.context?.shopifyOrderId === orderId);

  function renderCardEvidence(card: GiftLedgerCard) {
    return <details key={card.key} className="gift-ledger-card-evidence">
      <summary><span><bdi>•••• {card.lastCharacters || "—"}</bdi><small>מזהה <bdi>{numericId(card.giftCardId)}</bdi></small></span>
        <span>{card.purchaseConflict ? "נמצאו מקורות סותרים" : card.purchase ? card.purchase.orderNumber : "מקור הרכישה עדיין לא זוהה"}</span>
        <span>{card.uses.filter((use) => use.kind !== "REFUND").length} מימושים</span><ChevronDown size={16} /></summary>
      <div className="gift-ledger-proof">
        <p><ShieldCheck size={16} /> המעקב משתמש במזהה הכרטיס של Shopify. קוד המימוש המלא אינו נשמר.</p>
        {card.purchase && !card.purchaseConflict ? <div><span className="gift-ledger-step">הנפקה</span><div><strong>{card.purchase.customer || "פרטי הקונה לא התקבלו"}</strong><span><bdi>{card.purchase.email}</bdi></span>{caseFor(card.storeId, card.purchase.orderId) ? <button className="text-button" onClick={() => onOpenCase(caseFor(card.storeId, card.purchase!.orderId)!)}>חקירת הזמנה {card.purchase.orderNumber} <ArrowLeft size={13} /></button> : null}<a href={orderLink(card.storeId, card.purchase.orderId)} target="_blank" rel="noreferrer">הזמנה {card.purchase.orderNumber} ב־Shopify <ExternalLink size={13} /></a><small>{date(card.purchase.issuedAt)} · אירוע Shopify <bdi>{numericId(card.purchase.eventId)}</bdi></small></div></div> : <p>{card.purchaseConflict ? "יותר מהזמנת רכישה אחת מצביעה על אותו מזהה. הקישור אינו מוצג כמוכח עד לבדיקה." : "מזהה המימוש התקבל, אבל אירוע ההנפקה שלו עדיין לא נמצא. ייתכן שהרכישה מחוץ לטווח שנבדק או שהכרטיס הונפק ללא הזמנת רכישה. סריקת כל ההזמנות יכולה להשלים מקורות נוספים."}</p>}
        {card.uses.map((use) => <div key={use.transactionId}><span className="gift-ledger-step">{use.kind === "REFUND" ? "החזר" : "מימוש"}</span><div><strong>{use.order.customer} · <bdi>{money(use.amount, use.currency)}</bdi></strong><span><bdi>{use.order.email}</bdi></span><a href={orderLink(card.storeId, use.order.orderId)} target="_blank" rel="noreferrer">הזמנה {use.order.orderNumber} <ExternalLink size={13} /></a><small>{date(use.processedAt)} · עסקה מוצלחת <bdi>{numericId(use.transactionId)}</bdi></small></div></div>)}
        {!card.uses.length ? <p>לא נמצא מימוש בנתונים שנבדקו. זו אינה בדיקת יתרה.</p> : null}
      </div>
    </details>;
  }

  return <section className="product-page gift-ledger-page">
    <header className="gift-ledger-heading"><div><span className="eyebrow">חקירת תנועת גיפטקארדים</span><h1>מהרכישה למימוש</h1><p>אותו כרטיס. גם כשהקונה והמממש שונים.</p></div><button className="secondary-button" onClick={() => void onRefresh()} disabled={scanning}><RefreshCcw size={16} /> רענון</button></header>
    <div className="gift-ledger-summary"><div><span>כרטיסים שזוהו</span><strong>{scoped.length.toLocaleString("he-IL")}</strong></div><div><span>קישור מוכח מרכישה למימוש</span><strong>{exactCount.toLocaleString("he-IL")}</strong></div><div><span>מקור שדורש השלמה</span><strong>{missing.toLocaleString("he-IL")}</strong></div><p><Link2 size={18} />קונה ומממש שונים אינם כשלעצמם הוכחה להונאה.</p></div>
    <div className="gift-ledger-toolbar"><label className="gift-ledger-search"><Search size={17} /><input aria-label="חיפוש בגיפטקארדים" placeholder="שם, אימייל, הזמנה או מזהה כרטיס" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(30); }} /></label>
      <select aria-label="סינון לפי חנות" value={storeId} disabled={scanning} onChange={(event) => { setStoreId(event.target.value); setLimit(30); }}><option value="all">כל החנויות</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select>
      <div className="gift-ledger-scan"><select aria-label="טווח סריקת גיפטקארדים" disabled={scanning} value={mode} onChange={(event) => setMode(event.target.value)}><option value="alerts">הזמנות עם התראות</option><option value="all">כל ההזמנות · 30 יום</option></select><button className="primary-button" disabled={scanning || !stores.length} onClick={() => void scan()}><RefreshCcw size={16} className={scanning ? "gift-ledger-spinning" : ""} />{scanning ? "סורק…" : "סריקת Shopify"}</button></div>
    </div>
    {error ? <div className="gift-ledger-message gift-ledger-error" role="alert">{error}</div> : null}
    {progress ? <div className="gift-ledger-message" role="status">{progress}{scanning ? <button onClick={() => { stopped.current = true; }}>עצירה אחרי ההזמנות שבבדיקה</button> : null}</div> : null}
    <div className="gift-ledger-coverage"><span>{orders.length ? `${orders.length.toLocaleString("he-IL")} הזמנות גיפטקארד נבדקו` : "טרם נאספו ראיות"}{lastChecked ? ` · בדיקה אחרונה ${date(lastChecked)}` : ""}</span><span>{pending > 0 ? `${pending} כרטיסים או עסקאות ללא מזהה זמין · ` : ""}{orders.some((order) => !order.complete) ? "חלק מההזמנות נסרקו באופן חלקי · " : ""}מוצגות ראיות שנמצאו, לא יתרות כרטיסים</span></div>
    <div className="gift-ledger-tabs" role="group" aria-label="תצוגת גיפטקארדים"><button aria-pressed={tab === "routes"} onClick={() => { setTab("routes"); setLimit(30); }}>מסלולי מימוש <span>{routes.length}</span></button><button aria-pressed={tab === "cards"} onClick={() => { setTab("cards"); setLimit(30); }}>כל הכרטיסים <span>{cards.length}</span></button></div>
    {!scoped.length ? <div className="gift-ledger-empty"><Gift size={32} /><h2>המסלול מתחיל בראיות</h2><p>{stores.length ? "סרוק את הזמנות Shopify כדי לקשר בין הנפקת כרטיס למימוש שלו. יוצג רק מידע אמיתי מהחנות." : "חבר חנות כדי להתחיל במעקב גיפטקארדים."}</p><span>ללא קודי מימוש מלאים. ללא סימון אוטומטי של קונים כהונאה.</span></div> : tab === "cards" ? <div className="gift-ledger-card-list">{cards.slice(0, limit).map(renderCardEvidence)}</div> : <div className="gift-ledger-routes">{routes.slice(0, limit).map((route) => {
      const linked = route.cards.filter((card) => card.purchase && !card.purchaseConflict);
      const purchases = [...new Set(linked.map((card) => card.purchase!.orderId))];
      const emails = [...new Set(linked.map((card) => card.purchase!.email).filter(Boolean))];
      const alert = caseFor(route.storeId, route.order.orderId);
      const open = expanded === route.key;
      return <article className="gift-ledger-route" key={route.key}>
        <div className="gift-ledger-route-meta"><span>{storeFor(route.storeId)?.name} · {date(route.order.createdAt)}</span>{alert ? <button onClick={() => onOpenCase(alert)}>פתיחת חקירת ההזמנה <ArrowLeft size={14} /></button> : <span>לא נפתחה התראה להזמנה זו</span>}</div>
        <button className="gift-ledger-journey" aria-haspopup="dialog" onClick={() => setExpanded(route.key)}>
          <span className="gift-ledger-origin"><small>מקור הכרטיסים</small><strong>{purchases.length ? `${purchases.length} הזמנות רכישה` : "מקור הרכישה עדיין לא זוהה"}</strong><span>{emails.length === 1 ? <bdi>{emails[0]}</bdi> : emails.length ? `${emails.length} כתובות אימייל ברכישות` : "מזהה המימוש קיים; אירוע ההנפקה חסר"}</span></span>
          <span className="gift-ledger-bridge"><span>{route.cards.length} גיפטקארדים</span><i /><small>{linked.length} עם מקור מוכח</small></span>
          <span className="gift-ledger-destination"><small>הזמנת מימוש <bdi>{route.order.orderNumber}</bdi></small><strong>{route.order.customer}</strong><span><bdi>{route.order.email || "אימייל לא התקבל"}</bdi></span></span>
          <span className="gift-ledger-amount"><small>שולם בגיפטקארדים</small><strong><bdi>{money(route.amount, route.currency)}</bdi></strong><span>{open ? "סגירת הראיות" : "הצגת הכרטיסים"} <ChevronDown size={15} /></span></span>
        </button>
        {open ? <CenteredDialog label={`מסלול גיפטקארדים להזמנה ${route.order.orderNumber}`} onClose={() => setExpanded(null)}><header className="drawer-header"><div><span className="case-kicker">מסלול גיפטקארדים · {route.cards.length} כרטיסים</span><h2>מימוש בהזמנה {route.order.orderNumber}</h2><p>{route.order.customer} · שולם בגיפטקארדים <bdi>{money(route.amount, route.currency)}</bdi></p></div><button autoFocus className="icon-button" onClick={() => setExpanded(null)} aria-label="סגירת מסלול"><X size={20} /></button></header><div className="cluster-dialog-body"><p className="gift-money-note">{linked.length} מתוך {route.cards.length} כרטיסים עם מקור מוכח. לכל כרטיס מוצגים אירוע ההנפקה והמימושים המוצלחים; החזרים בנפרד.</p>{alert ? <button className="secondary-button" onClick={() => onOpenCase(alert)}>פתיחת חקירת הזמנה {route.order.orderNumber}<ArrowLeft size={15} /></button> : null}{route.cards.map(renderCardEvidence)}</div></CenteredDialog> : null}
      </article>;
    })}</div>}
    {scoped.length > 0 && !(tab === "routes" ? routes.length : cards.length) ? <div className="gift-ledger-empty"><h2>{needle ? "אין תוצאות לחיפוש" : "עדיין לא נמצאו מימושים"}</h2><p>{needle ? "נסה לחפש לפי מספר הזמנה או מזהה כרטיס." : "אפשר לראות את הכרטיסים שזוהו בלשונית כל הכרטיסים ולהרחיב את הסריקה."}</p></div> : null}
    {(tab === "routes" ? routes.length : cards.length) > limit ? <button className="secondary-button gift-ledger-more" onClick={() => setLimit((value) => value + 30)}>הצגת 30 נוספים</button> : null}
    <footer className="gift-ledger-footnote">קישור מוכח דורש אותו מזהה Shopify בהנפקה ובמימוש, באותה חנות. סריקת התראות בלבד אינה מכסה את כל רכישות החנות — ברירת המחדל היא כעת כל ההזמנות ב־30 יום. מקור חסר עשוי להיות מחוץ לטווח או כרטיס שהונפק ללא הזמנה. ארבעת התווים האחרונים אינם מספיקים לקישור.</footer>
  </section>;
}
