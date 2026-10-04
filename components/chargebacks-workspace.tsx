"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, CalendarClock, CheckCircle2, CircleDollarSign, CreditCard, ExternalLink, FileQuestion, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { CenteredDialog } from "@/components/centered-dialog";
import { formatHebrewDateTime } from "@/lib/hebrew-date";
import type { ChargebackMatchConfidence, CrediMatchChargeback, Store } from "@/lib/types";

const confidenceCopy: Record<ChargebackMatchConfidence, { label: string; detail: string }> = {
  exact: { label: "התאמה ודאית", detail: "הכרטיס, הסכום ומספר האישור או השובר זהים" },
  strong: { label: "התאמה חזקה", detail: "הכרטיס והסכום זהים ונמצאו סימני תשלום נוספים" },
  possible: { label: "דורש אימות", detail: "הסכום והיום תואמים, אך אין מספיק סימנים לאישור אוטומטי" },
  ambiguous: { label: "נמצאה מחלוקת", detail: "נמצאו כמה עסקאות באותו סכום ובאותו יום; לא בוצע חיבור אוטומטי" },
  unmatched: { label: "לא נמצאה הזמנה", detail: "לא נמצאה התאמה בין העסקאות שנסרקו. אפשר להפעיל חיפוש היסטורי לפי יום וסכום." },
};

const copyFor = (match: CrediMatchChargeback["match"] | undefined, confidence: ChargebackMatchConfidence) =>
  confidence === "exact" && match?.reasons.includes("סכום ויום ייחודיים")
    ? { label: "נמצאה עסקה לפי סכום ויום", detail: "נמצאה עסקה יחידה באותו סכום ובאותו יום" }
    : confidenceCopy[confidence];

const safeDate = (value?: string) => value && Number.isFinite(Date.parse(value)) ? formatHebrewDateTime(value) : "לא התקבל";
const money = (value?: number, currency = "ILS") => {
  if (value === undefined) return "—";
  try { return new Intl.NumberFormat("he-IL", { style: "currency", currency: currency || "ILS", maximumFractionDigits: 2 }).format(value); }
  catch { return `${value.toLocaleString("he-IL", { maximumFractionDigits: 2 })} ${currency || ""}`.trim(); }
};
const masked = (value?: string) => value ? `•••• ${value}` : "לא התקבל";

export function ChargebacksWorkspace({ tenantId, chargebacks, stores, onRefresh }: {
  tenantId: string;
  chargebacks: CrediMatchChargeback[];
  stores: Store[];
  onRefresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<CrediMatchChargeback | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChargebackMatchConfidence | "all">("all");
  const [backfillState, setBackfillState] = useState<"idle" | "loading" | "done" | "error" | "permission">("idle");
  const [backfillProgress, setBackfillProgress] = useState<string>();
  const [payPlusState, setPayPlusState] = useState<"idle" | "loading" | "done" | "error" | "configuration">("idle");
  const [payPlusProgress, setPayPlusProgress] = useState<string>();
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

  const backfillMatches = async () => {
    setBackfillState("loading");
    setBackfillProgress("מתחיל חיפוש מאובטח בהיסטוריית Shopify…");
    const now = Date.now();
    const dates = chargebacks.flatMap((item) => {
      const value = Date.parse(item.dealTime ?? item.creationTime ?? item.receivedAt);
      return Number.isFinite(value) ? [value] : [];
    });
    const earliest = dates.length ? Math.min(...dates) - 7 * 86_400_000 : now - 365 * 86_400_000;
    const since = new Date(Math.max(earliest, now - 365 * 86_400_000)).toISOString();
    const until = new Date(now).toISOString();
    let totalScanned = 0;
    try {
      for (const store of stores.filter((item) => item.status !== "disabled")) {
        let after: string | null = null;
        let scanned = 0;
        const seenCursors = new Set<string>();
        for (let page = 0; page < 2_000; page += 1) {
          const response = await fetch(`/api/tenants/${tenantId}/credimatch/backfill`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storeId: store.id, since, until, after, scanned }),
          });
          const result = await response.json() as { scanned?: number; nextCursor?: string | null; complete?: boolean; error?: string };
          if (!response.ok || !Number.isSafeInteger(result.scanned)) {
            if (response.status === 403 && result.error === "SHOPIFY_READ_ALL_ORDERS_REQUIRED") {
              setBackfillState("permission");
              setBackfillProgress("Shopify מאפשרת כרגע גישה ל־60 יום בלבד. נדרשת הרשאת read_all_orders למשיכה היסטורית.");
              return;
            }
            throw new Error(result.error ?? "CREDIMATCH_BACKFILL_FAILED");
          }
          scanned = result.scanned!;
          setBackfillProgress(`נבדקו ${Number(totalScanned + scanned).toLocaleString("he-IL")} הזמנות לצורך התאמה…`);
          if (result.complete) break;
          if (!result.nextCursor || seenCursors.has(result.nextCursor) || page === 1_999) throw new Error("CREDIMATCH_BACKFILL_CURSOR_FAILED");
          seenCursors.add(result.nextCursor);
          after = result.nextCursor;
        }
        totalScanned += scanned;
      }
      await onRefresh();
      setBackfillState("done");
      setBackfillProgress(`הבדיקה הושלמה מול ${totalScanned.toLocaleString("he-IL")} הזמנות. נשמרו רק פרטי התאמה מצומצמים.`);
    } catch {
      setBackfillState("error");
      setBackfillProgress("הבדיקה נעצרה לפני השלמה. המידע שכבר נבדק נשמר ואפשר להמשיך בניסיון נוסף.");
    }
  };

  const enrichWithPayPlus = async () => {
    setPayPlusState("loading");
    setPayPlusProgress("מאתר פרטי תשלום ב־PayPlus לפי מספרי האישור…");
    try {
      const response = await fetch(`/api/tenants/${tenantId}/payplus/reconcile`, { method: "POST" });
      const result = await response.json() as { checked?: number; found?: number; notFound?: number; conflicts?: number; errors?: number; error?: string };
      if (response.status === 503 && result.error === "PAYPLUS_NOT_CONFIGURED") {
        setPayPlusState("configuration");
        setPayPlusProgress("נדרשים מפתח API וסוד שרת של PayPlus בהגדרות השרת לפני תחילת ההצלבה.");
        return;
      }
      if (!response.ok || !Number.isSafeInteger(result.checked)) throw new Error(result.error ?? "PAYPLUS_RECONCILIATION_FAILED");
      await onRefresh();
      setPayPlusState("done");
      setPayPlusProgress(`נבדקו ${result.checked} הכחשות: נמצאו ${result.found ?? 0} התאמות ב־PayPlus${result.conflicts ? `, ו־${result.conflicts} הושארו לבדיקה משום שהפרטים סותרים` : ""}.`);
    } catch {
      setPayPlusState("error");
      setPayPlusProgress("ההצלבה מול PayPlus לא הושלמה. אפשר לנסות שוב; לא נשמרו מפתחות או פרטי כרטיס מלאים.");
    }
  };

  return <div className="page-content product-page chargebacks-page">
    <div className="page-heading"><div><h1>הכחשות אשראי</h1><p>הכחשות מ־CrediMatch מוצלבות מול PayPlus ו־Shopify לפי מספר אישור, כרטיס, סכום ומועד.</p></div>{chargebacks.length ? <div className="page-heading-actions">{stores.length ? <button className="secondary-button" onClick={backfillMatches} disabled={backfillState === "loading"}><RefreshCw size={16} className={backfillState === "loading" ? "spin" : undefined} />{backfillState === "loading" ? "מחפש התאמות…" : "חיפוש היסטורי"}</button> : null}<button className="secondary-button" onClick={enrichWithPayPlus} disabled={payPlusState === "loading"}><RefreshCw size={16} className={payPlusState === "loading" ? "spin" : undefined} />{payPlusState === "loading" ? "בודק PayPlus…" : "השלמת נתוני PayPlus"}</button></div> : null}</div>
    {backfillProgress ? <div className={`inline-notice ${backfillState === "error" || backfillState === "permission" ? "notice-warning" : ""}`} role="status">{backfillProgress}</div> : null}
    {payPlusProgress ? <div className={`inline-notice ${payPlusState === "error" || payPlusState === "configuration" ? "notice-warning" : ""}`} role="status">{payPlusProgress}</div> : null}

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
        <label><span className="sr-only">סינון לפי התאמה</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">כל ההתאמות</option><option value="exact">התאמה ודאית</option><option value="strong">התאמה חזקה</option><option value="possible">דורש אימות</option><option value="ambiguous">כמה עסקאות אפשריות</option><option value="unmatched">ללא הזמנה</option></select></label>
      </div>
      {visible.length ? <div className="chargeback-table" role="table" aria-label="הכחשות אשראי">
        <div className="chargeback-table-head" role="row"><span>הכחשה</span><span>עסקה</span><span>סכום</span><span>התאמה ל־Shopify</span><span>מצב</span></div>
        {visible.map((item) => {
          const confidence = item.match?.confidence ?? "unmatched";
          const copy = copyFor(item.match, confidence);
          return <button key={item.id} className="chargeback-row" role="row" onClick={() => setSelected(item)}>
            <span className="chargeback-id"><strong>#{item.discrepancyId}</strong><small>{item.type ?? "סוג הכחשה לא התקבל"}</small></span>
            <span><strong>{safeDate(item.dealTime)}</strong><small>{item.creditCompany ?? "חברת אשראי לא התקבלה"} · {masked(item.last4Digits)}</small></span>
            <span className="chargeback-amount"><strong>{money(item.originalAmount ?? item.grossAmount, item.currency)}</strong><small>{item.payments ? `${item.payments} תשלומים` : "תשלום אחד"}</small></span>
            <span className="chargeback-order"><strong>{confidence === "ambiguous" ? `${item.match?.candidates?.length ?? 0} עסקאות אפשריות` : item.match?.orderNumber ?? "לא נמצאה הזמנה"}</strong><small>{item.match?.customer || item.match?.email || copy.detail}</small></span>
            <span className={`match-status match-${confidence}`}><i aria-hidden="true" />{copy.label}<ArrowLeftRight size={15} aria-hidden="true" /></span>
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
  const copy = copyFor(match, confidence);
  const store = stores.find((candidate) => candidate.id === match?.storeId);
  const numericOrderId = match?.orderId?.match(/\d+$/)?.[0];
  const shopifyUrl = store?.domain && numericOrderId ? `https://${store.domain}/admin/orders/${numericOrderId}` : undefined;
  return <CenteredDialog label={`הכחשה ${item.discrepancyId}`} onClose={onClose} className="chargeback-dialog">
    <header className="drawer-header"><div><span className="eyebrow">CrediMatch · הכחשה #{item.discrepancyId}</span><h2>{item.type ?? "הכחשת אשראי"}</h2><p>{safeDate(item.creationTime ?? item.receivedAt)} · {item.status ?? "סטטוס לא התקבל"}</p></div><button className="icon-button" onClick={onClose} aria-label="סגירת פרטי הכחשה"><X size={19} /></button></header>
    <div className="chargeback-dialog-body">
      <section className={`chargeback-match-hero match-${confidence}`}>
        <div className="match-hero-icon">{["exact", "strong"].includes(confidence) ? <CheckCircle2 /> : <FileQuestion />}</div>
        <div><span>תוצאת ההצלבה</span><h3>{copy.label}</h3><p>{copy.detail}</p></div>
        {match?.score ? <strong>{match.score}<small>/100</small></strong> : null}
      </section>

      {match?.comparisons.length ? <section className="match-comparison"><div className="chargeback-section-title"><h3>איך התקבלה ההחלטה?</h3><span>רק שדות שקיימים בשני המקורות מסומנים כתואמים או שונים</span></div><div className="comparison-grid">{match.comparisons.map((comparison) => <div key={comparison.key} className={!comparison.compared ? "comparison-unavailable" : comparison.matched ? "comparison-match" : "comparison-miss"}><span>{comparison.label}</span><strong>{!comparison.compared ? "לא ניתן להשוות" : comparison.matched ? "תואם" : "שונה"}</strong><small className="comparison-values"><span className="comparison-side"><em>CrediMatch</em><bdi>{comparison.crediMatchValue ?? "לא התקבל"}</bdi></span><ArrowLeftRight size={13} aria-hidden="true" /><span className="comparison-side"><em>Shopify</em><bdi>{comparison.shopifyValue ?? "לא התקבל"}</bdi></span></small></div>)}</div></section> : null}

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
          <div><dt>רמת התאמה</dt><dd>{copy.label}</dd></div>
        </dl>{shopifyUrl ? <a className="secondary-button shopify-order-link" href={shopifyUrl} target="_blank" rel="noreferrer">פתיחת ההזמנה ב־Shopify <ExternalLink size={15} /></a> : null}</> : <div className="unmatched-guidance"><CalendarClock size={24} /><strong>ההכחשה נשמרה</strong><p>כאשר יש התאמה יחידה של סכום ויום, היא תוצג כ״דורש אימות״ בלבד. התאמה ודאית עדיין דורשת פרט תשלום נוסף.</p></div>}</section>
      </div>

      {item.payplus ? <section className="chargeback-facts payplus-evidence"><div className="chargeback-section-title"><h3>פרטי תשלום מ־PayPlus</h3><span>{item.payplus.status === "found" ? "נמצאה עסקה תואמת" : item.payplus.status === "conflict" ? "נדרשת בדיקה" : "לא נמצאה עסקה"}</span></div><dl>
        <div><dt>מספר אישור</dt><dd><bdi>{item.payplus.approvalNumber || "לא התקבל"}</bdi></dd></div>
        <div><dt>מזהה עסקה</dt><dd><bdi>{item.payplus.transactionUid ?? "לא התקבל"}</bdi></dd></div>
        <div><dt>מספר שובר</dt><dd><bdi>{item.payplus.voucherNumber ?? "לא התקבל"}</bdi></dd></div>
        <div><dt>סכום</dt><dd>{money(item.payplus.amount, item.payplus.currency ?? item.currency)}</dd></div>
        <div><dt>מועד תשלום</dt><dd>{safeDate(item.payplus.paidAt)}</dd></div>
        <div><dt>כרטיס</dt><dd>{masked(item.payplus.cardLast4)}</dd></div>
        <div><dt>לקוח</dt><dd>{item.payplus.customerName ?? "לא התקבל"}</dd></div>
        <div><dt>אימייל</dt><dd><bdi>{item.payplus.email ?? "לא התקבל"}</bdi></dd></div>
        <div><dt>טלפון</dt><dd><bdi>{item.payplus.phone ?? "לא התקבל"}</bdi></dd></div>
        {item.payplus.merchantReference ? <div><dt>אסמכתת חנות</dt><dd><bdi>{item.payplus.merchantReference}</bdi></dd></div> : null}
      </dl>{item.payplus.details && Object.keys(item.payplus.details).length ? <details className="payplus-details"><summary>כל הפרטים שחזרו מ־PayPlus ({Object.keys(item.payplus.details).length})</summary><dl>{Object.entries(item.payplus.details).map(([key, value]) => <div key={key}><dt><bdi>{key}</bdi></dt><dd><bdi>{value}</bdi></dd></div>)}</dl></details> : null}{item.payplus.message ? <p className="payplus-message">{item.payplus.message}</p> : null}</section> : null}

      {confidence === "ambiguous" && match?.candidates?.length ? <section className="settlement-section"><div className="chargeback-section-title"><h3>עסקאות אפשריות לבדיקה</h3><span>אותו סכום ואותו יום — בחר ידנית לאחר בדיקה</span></div><div className="settlement-list">{match.candidates.map((candidate) => <article key={candidate.orderId}><span>{candidate.orderNumber ?? "הזמנה"} · {candidate.customer || candidate.email || "לקוח לא התקבל"}</span><strong>{money(candidate.amount, candidate.currency)}</strong><small>{safeDate(candidate.createdAt)} · {candidate.storeName ?? "Shopify"}</small></article>)}</div></section> : null}

      {item.settlements.length ? <section className="settlement-section"><div className="chargeback-section-title"><h3>תנועות וזיכויים</h3><span>{item.settlements.length} רשומות כספיות</span></div><div className="settlement-list">{item.settlements.map((entry, index) => <article key={`${entry.invoiceNumber ?? "settlement"}-${index}`}><span>תשלום {entry.currentPaymentNumber ?? index + 1}</span><strong>{money(entry.netAmount ?? entry.expectedNetAmount, item.currency)}</strong><small>צפוי: {safeDate(entry.expectedPaymentTime)} · {entry.receptionStatus ?? "ללא סטטוס"}</small></article>)}</div></section> : null}
    </div>
  </CenteredDialog>;
}
