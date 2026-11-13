import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub Pages: "/" for the owner site, "/<repo>/" for project sites.
  base: process.env.PAGES_BASE_PATH || "/",
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
