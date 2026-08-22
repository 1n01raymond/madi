import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reporter: ["text", "json-summary"],
    },
    include: ["{apps,packages,tools}/**/*.test.ts"],
  },
});
