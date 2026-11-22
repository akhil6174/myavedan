import type { APIRoute } from "astro";
import { isSample, opportunities } from "../lib/snapshot";

// Pages worth indexing. Sample builds list nothing (they are noindex anyway).
const STATIC = ["/", "/explore/", "/can-i-apply/", "/admit-cards/", "/results/", "/about/", "/privacy/", "/terms/", "/disclaimer/"];

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL("https://myavedan.in");
  const urls = isSample
    ? []
    : [
        ...STATIC.map((path) => ({ loc: new URL(path, base).href, lastmod: null as string | null })),
        ...opportunities.map((o) => ({ loc: new URL(`/opportunity/${o.slug}/`, base).href, lastmod: o.provenance.last_checked_at.slice(0, 10) })),
      ];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
