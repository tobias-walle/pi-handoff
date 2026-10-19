import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("../", import.meta.url)),
  // Vite's transform cache belongs to the disposable test environment.
  cacheDir: process.env.PI_TEST_CACHE_DIR ?? ".check-cache/vite",
  test: {
    include: ["tests/**/*.test.ts", "extensions/**/*.test.ts"],
    setupFiles: ["tests/support/isolated-agent.ts"],
    pool: "forks",
    maxWorkers: 2,
    isolate: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
