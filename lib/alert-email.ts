import type { FraudCase } from "./types";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const severityNames = { low: "נמוך", medium: "בינוני", high: "גבוה", critical: "קריטי" };

export function buildAlertEmail(item: FraudCase, appUrl: string, test = false) {
  const network = item.evidence.some(e => e.source === "network");
  const matches = item.signals?.blacklist;
  const fields: [keyof NonNullable<typeof matches>, string, string | undefined][] = [
    ["email", "אימייל", item.email], ["phone", "טלפון", item.context?.phone],
    ["address", "כתובת", item.context?.address], ["ip", "כתובת IP", item.context?.ip],
    ["customer", "מזהה לקוח בחנות", item.context?.customerId],
  ];
  const matchedFields = network ? fields.filter(([key]) => matches?.[key]).map(([, label, value]) => `${label}${value ? `: ${value}` : ""}`) : [];
  const summary = test ? "זו הודעת בדיקה בלבד. לא זוהתה כאן הזמנה חשודה אמיתית." : network
    ? "פרט אחד או יותר בהזמנה תואמים לפרטים שנשמרו במאגר הדיווחים המשותף. זו הסיבה שההזמנה נשלחה לבדיקה."
    : `ההזמנה נשלחה לבדיקה בעקבות: ${item.reason}.`;
  const details = [...new Set(item.evidence.map(e => `${e.label}${e.description ? ` — ${e.description}` : ""}`))];
  if (network) {
    details.unshift(matchedFields.length ? `הפרטים שהתאימו למאגר: ${matchedFields.join("; ")}.` : "לא נשמר פירוט של סוג המזהה שהתאים למאגר. אין להסיק מהכותרת בלבד איזה פרט התאים.");
    details.push("התאמה למאגר אינה מוכיחה שהלקוח הזה ביצע הונאה או הכחשת עסקה. התאמה בכתובת IP בלבד אינה מזהה אדם בוודאות.");
  }
  if (!details.length && !test) details.push("לא נשמר פירוט נוסף לתנאי ההתראה. יש לבדוק את ההזמנה לפני קבלת החלטה.");
  const date = item.occurredAt && Number.isFinite(Date.parse(item.occurredAt))
    ? new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(new Date(item.occurredAt)) : "לא התקבל מועד ההזמנה";
  const rows = [["חנות", item.storeName], ["הזמנה", item.orderNumber], ["לקוח", item.customer], ["מועד ההזמנה (ישראל)", date], ["סכום ההזמנה", Number.isFinite(item.amount) ? `${item.amount.toLocaleString("he-IL")} ₪` : "לא התקבל"], ["רמת סיכון", severityNames[item.severity]]];
  const recommendation = test ? "אין צורך לטפל בהזמנה. ההודעה נועדה לבדוק את קבלת ההתראות." : network
    ? "פתחו את התיק, בדקו את הפרט שהתאים ואת ההיסטוריה הזמינה, ואמתו את פרטי ההזמנה עם הלקוח לפני החלטה על אספקה או ביטול."
    : "פתחו את התיק, בדקו את ההזמנות והנתונים שמופיעים בראיות, והחליטו אם ההזמנה תקינה או דורשת בירור עם הלקוח.";
  const title = test ? "בדיקת התראות ShopShield" : `בדיקת הזמנה ${item.orderNumber}: ${item.reason}`;
  const text = [title, "מה קרה?", summary, ...rows.map(([k,v]) => `${k}: ${v}`), "מה נמצא בפועל?", ...details, "מה מומלץ לעשות?", recommendation, "ההתראה לבדה אינה הוכחה להונאה ואינה מבטלת או חוסמת את ההזמנה.", `לפתיחת המערכת: ${appUrl}`].join("\n\n");
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif;background:#f4f6f4;padding:20px;color:#17211d"><div style="max-width:600px;margin:auto;background:white;border:1px solid #dfe5e1;border-radius:16px;padding:24px"><div style="color:#007a5a;font-weight:bold">ShopShield · ${test ? "הודעת בדיקה" : "התראת סיכון"}</div><h1 style="font-size:24px;line-height:1.4">${escapeHtml(title)}</h1><h2 style="font-size:18px">מה קרה?</h2><p style="line-height:1.7">${escapeHtml(summary)}</p><table style="width:100%;border-collapse:collapse">${rows.map(([k,v]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #eee">${escapeHtml(k)}</td><td style="padding:10px;border-bottom:1px solid #eee;font-weight:bold">${escapeHtml(v)}</td></tr>`).join("")}</table>${details.length ? `<h2 style="font-size:18px">מה נמצא בפועל?</h2>${details.map(d => `<p style="line-height:1.7;white-space:pre-line;overflow-wrap:anywhere">${escapeHtml(d)}</p>`).join("")}` : ""}<h2 style="font-size:18px">מה מומלץ לעשות?</h2><p style="line-height:1.7">${escapeHtml(recommendation)}</p><a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#007a5a;color:white;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:bold">פתחו את המערכת לבדיקת ההזמנה</a><p style="font-size:13px;line-height:1.6;color:#58665f">ההתראה לבדה אינה הוכחה להונאה ואינה מבטלת או חוסמת את ההזמנה.</p></div></div>`;
  return { subject: `${test ? "בדיקה — " : ""}${item.reason} · הזמנה ${item.orderNumber} · ${item.storeName}`, html, text };
}
