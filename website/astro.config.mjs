import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://diffloupe.com",
  output: "static",
  trailingSlash: "always",
  build: { inlineStylesheets: "never" },
  devToolbar: { enabled: false },
  vite: { build: { assetsInlineLimit: 0 } },
});
