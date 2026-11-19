/**
 * IST date helpers.
 *
 * Every public date in MyAvedan is Indian Standard Time (+05:30, no daylight saving).
 * Stored values are either:
 *   - date-only  "YYYY-MM-DD"                 → that calendar day in IST
 *   - date-time  "YYYY-MM-DDTHH:mm(:ss)+05:30" → the exact stated time
 *
 * Calendar arithmetic is done on "YYYY-MM-DD" strings through UTC midnight, so the
 * viewer's own time zone never leaks in.
 */

export const IST_OFFSET_MINUTES = 330;
const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value);
}

/** Calendar date part of a stored value. */
export function datePart(value: string): string {
  return value.slice(0, 10);
}

/** Instant when a stored value begins: date-only means 00:00 IST that day. */
export function startInstant(value: string): number {
  return isDateOnly(value) ? Date.parse(`${value}T00:00:00+05:30`) : Date.parse(value);
}

/** Instant when a deadline ends: date-only means 23:59:59.999 IST that day; a stated time is kept. */
export function endInstant(value: string): number {
  return isDateOnly(value) ? Date.parse(`${value}T23:59:59.999+05:30`) : Date.parse(value);
}

/** IST calendar date ("YYYY-MM-DD") for an instant. */
export function istDate(ms: number): string {
  return new Date(ms + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** Whole calendar days from date a to date b (both "YYYY-MM-DD"). Positive when b is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Move a calendar date by whole years. 29 Feb in a non-leap target year becomes 1 Mar,
 * which keeps "born on or after" bounds correct when an age relaxation is applied.
 */
export function shiftYears(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const year = y + years;
  if (m === 2 && d === 29 && !isLeapYear(year)) return `${pad(year, 4)}-03-01`;
  return `${pad(year, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** "15 Dec 2026" */
export function formatDate(value: string): string {
  const [y, m, d] = datePart(value).split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** "23:59 IST" for a date-time value, or "" for a date-only value. */
export function formatTime(value: string): string {
  if (isDateOnly(value)) return "";
  return `${value.slice(11, 16)} IST`;
}

/** "15 Dec 2026, 23:59 IST" or "15 Dec 2026". */
export function formatDateTime(value: string): string {
  const time = formatTime(value);
  return time ? `${formatDate(value)}, ${time}` : formatDate(value);
}

/** Calendar export stamp "YYYYMMDD" for an all-day event. */
export function icsDate(value: string): string {
  return datePart(value).replaceAll("-", "");
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}
