import { fileURLToPath } from "node:url";
import { defineConfig } from "oxlint";

// Isolated rule tests use the same spacing rule without unrelated
// product/type-aware policy diagnostics.
export default defineConfig({
  plugins: [],
  categories: { correctness: "off" },
  jsPlugins: [
    {
      name: "readable",
      specifier: fileURLToPath(
        new URL("./logical-spacing.ts", import.meta.url),
      ),
    },
  ],
  options: { denyWarnings: true },
  rules: { "readable/logical-spacing": "error" },
});
