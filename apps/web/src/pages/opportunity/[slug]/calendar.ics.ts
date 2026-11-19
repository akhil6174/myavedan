/**
 * Calendar file for one opportunity: every dated milestone as an all-day event,
 * with a reminder the day before. Built statically, so it costs nothing to serve.
 */
import type { APIRoute } from "astro";
import { DATE_LABEL, addDays, datePart, formatTime, icsDate, type Opportunity } from "@myavedan/schema";
import { opportunities } from "../../../lib/snapshot";

export function getStaticPaths() {
  return opportunities.map((o) => ({ params: { slug: o.slug }, props: { o } }));
}

const KINDS = ["apply_start", "apply_end", "fee_end", "correction_start", "correction_end", "exam", "admit_card", "result"] as const;

function escape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Fold lines longer than 75 octets, as RFC 5545 requires. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

function build(o: Opportunity, stamp: string): string {
  const url = `https://myavedan.in/opportunity/${o.slug}/`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TrutiAI//MyAvedan//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const d of o.dates) {
    if (!d.value || !(KINDS as readonly string[]).includes(d.kind)) continue;
    const day = datePart(d.value);
    const time = formatTime(d.value);
    const summary = `${DATE_LABEL[d.kind]}${time ? ` (till ${time})` : ""}${d.tentative ? " (tentative)" : ""}: ${o.title}`;
    const description = `${o.organization.name}${o.advt_no ? `, Advt. No. ${o.advt_no}` : ""}. Confirm in the official notice: ${o.links.notice_pdf}. Details: ${url}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${o.id}-${d.kind}-v${o.provenance.version}@myavedan.in`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(day)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(day, 1))}`,
      `SUMMARY:${escape(summary)}`,
      `DESCRIPTION:${escape(description)}`,
      `URL:${url}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-P1D",
      `DESCRIPTION:${escape(`Tomorrow: ${DATE_LABEL[d.kind]}`)}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export const GET: APIRoute = ({ props }) => {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return new Response(build(props.o as Opportunity, stamp), {
    headers: { "Content-Type": "text/calendar; charset=utf-8" },
  });
};
