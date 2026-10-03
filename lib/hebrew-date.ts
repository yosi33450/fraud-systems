const timeZone = "Asia/Jerusalem";

const dateFormatter = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeZone });
const dateTimeFormatter = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone });
const timeFormatter = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });

/** Formats a known timestamp for Hebrew UI. A midnight time carries no useful information. */
export function formatHebrewDateTime(value: string | undefined, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return timeFormatter.format(date) === "00:00" ? dateFormatter.format(date) : dateTimeFormatter.format(date);
}

export function israelDateKey(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const year = part("year"); const month = part("month"); const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : undefined;
}
