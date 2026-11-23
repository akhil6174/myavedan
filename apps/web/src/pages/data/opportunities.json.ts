import type { APIRoute } from "astro";
import { EVENT_LABEL } from "@myavedan/schema";
import { opportunities, statusInput } from "../../lib/snapshot";

/**
 * Compact data for checks that run in the visitor's browser: eligibility labels on cards (from the
 * saved profile) and update alerts for recruitments the visitor applied to. Nothing is sent back.
 */
export const GET: APIRoute = () => {
  const items = opportunities.map((o) => ({
    slug: o.slug,
    title: o.title,
    organization: o.organization.name,
    status: statusInput(o),
    posts: o.posts.map(({ id, name, rules }) => ({ id, name, rules })),
    updates: o.events.map((e) => ({
      id: `${e.kind}:${e.date}:${e.link}`,
      kind: e.kind,
      label: EVENT_LABEL[e.kind],
      date: e.date,
      title: e.title,
      link: e.link,
    })),
  }));
  return new Response(JSON.stringify({ items }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
