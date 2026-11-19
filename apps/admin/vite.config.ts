import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";

// In development the console runs on :4322 and forwards /api to the local Worker on :8787.
export default defineConfig({
  plugins: [preact(), tailwindcss()],
  server: {
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
