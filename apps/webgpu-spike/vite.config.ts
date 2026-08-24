import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const compiledSceneDirectory = resolve(
  repositoryRoot,
  process.env.NARU_SCENE_DIR ?? "artifacts/phase1/adafruit-pygamer",
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
