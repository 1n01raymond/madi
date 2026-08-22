import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const compiledSceneDirectory = fileURLToPath(
  new URL("../../artifacts/phase1/adafruit-pygamer", import.meta.url),
);

export default defineConfig({
  publicDir: compiledSceneDirectory,
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
});
