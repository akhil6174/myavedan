/**
 * Real-world status of an opportunity, derived from its dates and later documents.
 * Never stored: computed at build time and again in the browser on page load,
 * so a page built yesterday cannot keep saying "Open" after the deadline.
 *
 * Imports only types, so islands can use it without shipping zod.
 */
import type { ImportantDate, OpportunityEvent, DateKind, EventKind } from "./types";
import { datePart, daysBetween, endInstant, formatTime, istDate, startInstant } from "./dates";

export type Status =
  | "upcoming"
  | "open"
  | "closed"
  | "admit_card_out"
  | "answer_key_out"
  | "result_out"
  | "archived"
  | "cancelled";

export interface StatusInfo {
  status: Status;
  /** Open and closing within CLOSING_SOON_DAYS. */
  closingSoon: boolean;
  /** Calendar days (IST) until the application deadline while open. */
  daysLeft: number | null;
  /** Calendar days (IST) until applications open while upcoming. */
  daysToOpen: number | null;
  /** Stored apply_end value, for display. */
  closesAt: string | null;
}

export const CLOSING_SOON_DAYS = 7;
export const ARCHIVE_AFTER_RESULT_DAYS = 90;
export const ARCHIVE_AFTER_CLOSE_DAYS = 365;

interface StatusInput {
  dates: Pick<ImportantDate, "kind" | "value">[];
  events: Pick<OpportunityEvent, "kind" | "date">[];
}

export function dateValue(dates: StatusInput["dates"], kind: DateKind): string | null {
  return dates.find((d) => d.kind === kind && d.value)?.value ?? null;
}

function latestEvent(events: StatusInput["events"], kind: EventKind): string | null {
  const found = events.filter((e) => e.kind === kind).map((e) => e.date).sort();
  return found.length ? (found[found.length - 1] ?? null) : null;
}

export function computeStatus(o: StatusInput, now: number = Date.now()): StatusInfo {
  const applyStart = dateValue(o.dates, "apply_start");
  const applyEnd = dateValue(o.dates, "apply_end");
  const today = istDate(now);
  const base: StatusInfo = { status: "upcoming", closingSoon: false, daysLeft: null, daysToOpen: null, closesAt: applyEnd };

  if (latestEvent(o.events, "cancelled")) return { ...base, status: "cancelled" };

  const result = latestEvent(o.events, "result");
  if (result) {
    return { ...base, status: daysBetween(result, today) > ARCHIVE_AFTER_RESULT_DAYS ? "archived" : "result_out" };
  }
  if (latestEvent(o.events, "answer_key")) return { ...base, status: "answer_key_out" };
  if (latestEvent(o.events, "admit_card")) return { ...base, status: "admit_card_out" };

  if (applyEnd && now > endInstant(applyEnd)) {
    const since = daysBetween(datePart(applyEnd), today);
    return { ...base, status: since > ARCHIVE_AFTER_CLOSE_DAYS ? "archived" : "closed" };
  }
  if (applyStart && now < startInstant(applyStart)) {
    return { ...base, status: "upcoming", daysToOpen: daysBetween(today, datePart(applyStart)) };
  }
  if (applyEnd) {
    const daysLeft = daysBetween(today, datePart(applyEnd));
    return { ...base, status: "open", daysLeft, closingSoon: daysLeft <= CLOSING_SOON_DAYS };
  }
  // No deadline stated: open once applications have started, otherwise upcoming.
  return { ...base, status: applyStart ? "open" : "upcoming" };
}

export const STATUS_LABEL: Record<Status, string> = {
  upcoming: "Upcoming",
  open: "Open",
  closed: "Closed",
  admit_card_out: "Admit card out",
  answer_key_out: "Answer key out",
  result_out: "Result out",
  archived: "Archived",
  cancelled: "Cancelled",
};

export type StatusTone = "open" | "soon" | "neutral" | "update" | "stopped";

export function statusTone(info: StatusInfo): StatusTone {
  if (info.status === "open") return info.closingSoon ? "soon" : "open";
  if (info.status === "cancelled") return "stopped";
  if (info.status === "admit_card_out" || info.status === "answer_key_out" || info.status === "result_out") return "update";
  return "neutral";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Open · closes in 28 days", "Open · closes today, 23:59 IST", "Upcoming · opens in 3 days" … */
export function describeStatus(info: StatusInfo): string {
  const label = STATUS_LABEL[info.status];
  if (info.status === "open" && info.daysLeft !== null) {
    if (info.daysLeft === 0) {
      const time = info.closesAt ? formatTime(info.closesAt) : "";
      return `${label} · closes today${time ? `, ${time}` : ""}`;
    }
    return `${label} · closes in ${plural(info.daysLeft, "day")}`;
  }
  if (info.status === "upcoming" && info.daysToOpen !== null) {
    return info.daysToOpen === 0 ? `${label} · opens today` : `${label} · opens in ${plural(info.daysToOpen, "day")}`;
  }
  return label;
}
