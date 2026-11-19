import type { APIRoute } from "astro";
import { isSample } from "../lib/snapshot";

// Keep sample data out of search engines.
export const GET: APIRoute = ({ site }) => {
  const body = isSample
    ? "User-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\nSitemap: ${new URL("/sitemap.xml", site ?? "https://myavedan.in").href}\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
