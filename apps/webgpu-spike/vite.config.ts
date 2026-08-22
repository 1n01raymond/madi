import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const evidenceDirectory = fileURLToPath(
  new URL("../../artifacts/occt", import.meta.url),
);

export default defineConfig({
  publicDir: evidenceDirectory,
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
});
