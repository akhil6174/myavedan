import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import tailwindcss from "@tailwindcss/vite";

// Static output only: every page is built from data/snapshot.json and served from the CDN.
export default defineConfig({
  site: "https://myavedan.in",
  output: "static",
  trailingSlash: "always",
  integrations: [preact()],
  vite: {
    plugins: [tailwindcss()],
  },
});
