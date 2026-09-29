"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, CalendarClock, CheckCircle2, CircleDollarSign, CreditCard, ExternalLink, FileQuestion, Search, ShieldCheck, X } from "lucide-react";
import { CenteredDialog } from "@/components/centered-dialog";
import type { ChargebackMatchConfidence, CrediMatchChargeback, Store } from "@/lib/types";

const confidenceCopy: Record<ChargebackMatchConfidence, { label: string; detail: string }> = {
  exact: { label: "התאמה ודאית", detail: "מספר אישור או שובר וסכום זהים" },
  strong: { label: "התאמה חזקה", detail: "כמה פרטי תשלום תואמים" },
  possible: { label: "דורש אימות", detail: "נמצאה הזמנה אפשרית, אך אין מספיק סימנים לאישור אוטומטי" },
  unmatched: { label: "לא נמצאה הזמנה", detail: "נשמרה לבדיקה חוזרת לאחר סנכרון Shopify" },
};

const dateFormatter = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" });
const safeDate = (value?: string) => value && Number.isFinite(Date.parse(value)) ? dateFormatter.format(new Date(value)) : "לא התקבל";
const money = (value?: number, currency = "ILS") => {
  if (value === undefined) return "—";
  try { return new Intl.NumberFormat("he-IL", { style: "currency", currency: currency || "ILS", maximumFractionDigits: 2 }).format(value); }
  catch { return `${value.toLocaleString("he-IL", { maximumFractionDigits: 2 })} ${currency || ""}`.trim(); }
};
const masked = (value?: string) => value ? `•••• ${value}` : "לא התקבל";

export function ChargebacksWorkspace({ chargebacks, stores }: { chargebacks: CrediMatchChargeback[]; stores: Store[] }) {
  const [selected, setSelected] = useState<CrediMatchChargeback | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChargebackMatchConfidence | "all">("all");
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return chargebacks.filter((item) => {
      const match = item.match;
      const searchable = [item.discrepancyId, item.confirmationNumber, item.creditCompany, item.type, item.status, match?.orderNumber, match?.customer, match?.email];
      return (!search || searchable.some((value) => value?.toLowerCase().includes(search))) && (filter === "all" || (match?.confidence ?? "unmatched") === filter);
    });
  }, [chargebacks, filter, query]);
  const linked = chargebacks.filter((item) => ["exact", "strong"].includes(item.match?.confidence ?? "")).length;
  const unresolved = chargebacks.filter((item) => !["exact", "strong"].includes(item.match?.confidence ?? "")).length;
  const total = chargebacks.reduce((sum, item) => sum + (item.originalAmount ?? item.grossAmount ?? 0), 0);

  return <div className="page-content product-page chargebacks-page">
    <div className="page-heading"><div><h1>הכחשות אשראי</h1><p>הכחשות מ־CrediMatch מוצלבות מול עסקאות Shopify לפי מספר אישור, כרטיס, סכום ומועד.</p></div></div>

    <section className="chargeback-summary" aria-label="סיכום הכחשות">
      <div className="chargeback-summary-primary"><span><FileQuestion size={18} /> הכחשות שנקלטו</span><strong>{chargebacks.length.toLocaleString("he-IL")}</strong><small>המידע מגיע ישירות מ־CrediMatch</small></div>
      <div><span><CircleDollarSign size={17} /> סכום במחלוקת</span><strong>{money(total)}</strong><small>לפני זיכויים ועמלות</small></div>
      <div><span><ShieldCheck size={17} /> חוברו להזמנה</span><strong>{linked.toLocaleString("he-IL")}</strong><small>{chargebacks.length ? `${Math.round(linked / chargebacks.length * 100)}% מההכחשות` : "אין עדיין נתונים"}</small></div>
      <div><span><FileQuestion size={17} /> דורשות בדיקה</span><strong>{unresolved.toLocaleString("he-IL")}</strong><small>ללא חיבור אוטומטי ודאי</small></div>
    </section>

    <section className="chargeback-ledger">
      <div className="section-heading"><div><h2>יומן התאמות</h2><span>{visible.length} מתוך {chargebacks.length} הכחשות</span></div></div>
      <div className="chargeback-toolbar">
        <label className="search-box"><Search size={17} /><span className="sr-only">חיפוש הכחשה</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="חיפוש לפי הכחשה, הזמנה או לקוח" /></label>
        <label><span className="sr-only">סינון לפי התאמה</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">כל ההתאמות</option><option value="exact">התאמה ודאית</option><option value="strong">התאמה חזקה</option><option value="possible">דורש אימות</option><option value="unmatched">ללא הזמנה</option></select></label>
      </div>
      {visible.length ? <div className="chargeback-table" role="table" aria-label="הכחשות אשראי">
        <div className="chargeback-table-head" role="row"><span>הכחשה</span><span>עסקה</span><span>סכום</span><span>התאמה ל־Shopify</span><span>מצב</span></div>
        {visible.map((item) => {
          const confidence = item.match?.confidence ?? "unmatched";
          return <button key={item.id} className="chargeback-row" role="row" onClick={() => setSelected(item)}>
            <span className="chargeback-id"><strong>#{item.discrepancyId}</strong><small>{item.type ?? "סוג הכחשה לא התקבל"}</small></span>
            <span><strong>{safeDate(item.dealTime)}</strong><small>{item.creditCompany ?? "חברת אשראי לא התקבלה"} · {masked(item.last4Digits)}</small></span>
            <span className="chargeback-amount"><strong>{money(item.originalAmount ?? item.grossAmount, item.currency)}</strong><small>{item.payments ? `${item.payments} תשלומים` : "תשלום אחד"}</small></span>
            <span className="chargeback-order"><strong>{item.match?.orderNumber ?? "לא נמצאה הזמנה"}</strong><small>{item.match?.customer || item.match?.email || confidenceCopy[confidence].detail}</small></span>
            <span className={`match-status match-${confidence}`}><i aria-hidden="true" />{confidenceCopy[confidence].label}<ArrowLeftRight size={15} aria-hidden="true" /></span>
          </button>;
        })}
      </div> : <div className="empty-state chargeback-empty"><CreditCard size={26} /><strong>{chargebacks.length ? "אין תוצאות למסנן שבחרת" : "עדיין לא נקלטו הכחשות"}</strong><span>{chargebacks.length ? "נסה חיפוש אחר או הצג את כל ההתאמות." : "כאשר CrediMatch תשלח הכחשה, היא תופיע כאן ותיבדק מול Shopify."}</span></div>}
    </section>

    {selected ? <ChargebackDialog item={selected} stores={stores} onClose={() => setSelected(null)} /> : null}
  </div>;
}

function ChargebackDialog({ item, stores, onClose }: { item: CrediMatchChargeback; stores: Store[]; onClose: () => void }) {
  const match = item.match;
  const confidence = match?.confidence ?? "unmatched";
  const store = stores.find((candidate) => candidate.id === match?.storeId);
  const numericOrderId = match?.orderId?.match(/\d+$/)?.[0];
  const shopifyUrl = store?.domain && numericOrderId ? `https://${store.domain}/admin/orders/${numericOrderId}` : undefined;
  return <CenteredDialog label={`הכחשה ${item.discrepancyId}`} onClose={onClose} className="chargeback-dialog">
    <header className="drawer-header"><div><span className="eyebrow">CrediMatch · הכחשה #{item.discrepancyId}</span><h2>{item.type ?? "הכחשת אשראי"}</h2><p>{safeDate(item.creationTime ?? item.receivedAt)} · {item.status ?? "סטטוס לא התקבל"}</p></div><button className="icon-button" onClick={onClose} aria-label="סגירת פרטי הכחשה"><X size={19} /></button></header>
    <div className="chargeback-dialog-body">
      <section className={`chargeback-match-hero match-${confidence}`}>
        <div className="match-hero-icon">{["exact", "strong"].includes(confidence) ? <CheckCircle2 /> : <FileQuestion />}</div>
        <div><span>תוצאת ההצלבה</span><h3>{confidenceCopy[confidence].label}</h3><p>{confidenceCopy[confidence].detail}</p></div>
        {match?.score ? <strong>{match.score}<small>/100</small></strong> : null}
      </section>

      {match?.comparisons.length ? <section className="match-comparison"><div className="chargeback-section-title"><h3>איך התקבלה ההחלטה?</h3><span>כל סימן נבדק מול העסקה שנמצאה</span></div><div className="comparison-grid">{match.comparisons.map((comparison) => <div key={comparison.key} className={comparison.matched ? "comparison-match" : "comparison-miss"}><span>{comparison.label}</span><strong>{comparison.matched ? "תואם" : "לא תואם"}</strong><small><bdi>{comparison.crediMatchValue ?? "—"}</bdi><ArrowLeftRight size={13} /><bdi>{comparison.shopifyValue ?? "—"}</bdi></small></div>)}</div></section> : null}

      <div className="chargeback-split">
        <section className="chargeback-facts"><div className="chargeback-section-title"><h3>ההכחשה מ־CrediMatch</h3><span>נתוני חברת האשראי</span></div><dl>
          <div><dt>סכום מקורי</dt><dd>{money(item.originalAmount ?? item.grossAmount, item.currency)}</dd></div>
          <div><dt>מועד העסקה</dt><dd>{safeDate(item.dealTime)}</dd></div>
          <div><dt>כרטיס</dt><dd>{item.cardBrand || item.creditCompany || "—"} · {masked(item.last4Digits)}</dd></div>
          <div><dt>מספר אישור</dt><dd><bdi>{item.confirmationNumber ?? "לא התקבל"}</bdi></dd></div>
          <div><dt>מספר שובר</dt><dd><bdi>{item.voucherNumber ?? "לא התקבל"}</bdi></dd></div>
          <div><dt>מסוף</dt><dd><bdi>{item.terminalNumber ?? "לא התקבל"}</bdi></dd></div>
          <div><dt>פרטים נוספים</dt><dd>{item.additionalDetails ?? item.inquiryReason ?? item.comment ?? "לא התקבלו פרטים נוספים"}</dd></div>
        </dl></section>
        <section className="chargeback-facts shopify-match"><div className="chargeback-section-title"><h3>הזמנת Shopify</h3><span>{match?.storeName ?? "החנות המחוברת"}</span></div>{match?.orderId ? <><div className="matched-order-number"><span>{match.orderNumber ?? "הזמנה"}</span><strong>{money(match.amount, match.currency)}</strong></div><dl>
          <div><dt>לקוח</dt><dd>{match.customer || "לא התקבל שם"}</dd></div>
          <div><dt>אימייל</dt><dd><bdi>{match.email || "לא התקבל"}</bdi></dd></div>
          <div><dt>מועד הזמנה</dt><dd>{safeDate(match.createdAt)}</dd></div>
          <div><dt>רמת התאמה</dt><dd>{confidenceCopy[confidence].label}</dd></div>
        </dl>{shopifyUrl ? <a className="secondary-button shopify-order-link" href={shopifyUrl} target="_blank" rel="noreferrer">פתיחת ההזמנה ב־Shopify <ExternalLink size={15} /></a> : null}</> : <div className="unmatched-guidance"><CalendarClock size={24} /><strong>ההכחשה נשמרה</strong><p>לא נחבר אותה להזמנה על סמך סכום בלבד. לאחר סנכרון נוסף נבדוק אותה שוב אוטומטית.</p></div>}</section>
      </div>

      {item.settlements.length ? <section className="settlement-section"><div className="chargeback-section-title"><h3>תנועות וזיכויים</h3><span>{item.settlements.length} רשומות כספיות</span></div><div className="settlement-list">{item.settlements.map((entry, index) => <article key={`${entry.invoiceNumber ?? "settlement"}-${index}`}><span>תשלום {entry.currentPaymentNumber ?? index + 1}</span><strong>{money(entry.netAmount ?? entry.expectedNetAmount, item.currency)}</strong><small>צפוי: {safeDate(entry.expectedPaymentTime)} · {entry.receptionStatus ?? "ללא סטטוס"}</small></article>)}</div></section> : null}
    </div>
  </CenteredDialog>;
}
