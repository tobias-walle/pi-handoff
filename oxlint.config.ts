import { fileURLToPath } from "node:url";
import { defineConfig } from "oxlint";

// Strict readability and type-aware rules apply to production code and tests.
export default defineConfig({
  plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "promise"],
  jsPlugins: [
    {
      name: "readable",
      specifier: fileURLToPath(
        new URL("./scripts/logical-spacing.ts", import.meta.url),
      ),
    },
    {
      name: "sonarjs",
      specifier: fileURLToPath(import.meta.resolve("eslint-plugin-sonarjs")),
    },
  ],
  options: {
    typeAware: true,
    denyWarnings: true,
    reportUnusedDisableDirectives: "error",
  },
  categories: {
    correctness: "error",
    suspicious: "error",
    pedantic: "error",
    perf: "error",
  },
  rules: {
    "readable/logical-spacing": "error",
    "sonarjs/cognitive-complexity": ["error", 15],
    // The plan excludes hard size limits. Categories enable these implicitly.
    "max-lines": "off",
    "max-lines-per-function": "off",
    // Review mutability and scheduling by intent, not blanket type/syntax rules.
    "typescript/prefer-readonly-parameter-types": "off",
    "no-await-in-loop": "off",
    // Syntax-only matching mistakes SDK find(provider, id) for Array.find().
    "unicorn/no-array-callback-reference": "off",
    complexity: ["error", 10],
    "max-depth": ["error", 3],
    "max-nested-callbacks": ["error", 3],
    "no-nested-ternary": "error",
    "prefer-template": "error",
    "sort-imports": ["error", { ignoreDeclarationSort: true }],
    "import/no-duplicates": "error",
    "default-param-last": "error",
    "no-unused-vars": ["error", { args: "all", caughtErrors: "all" }],
    "no-underscore-dangle": "off",
    "unicorn/consistent-function-scoping": "off",
    "import/no-unassigned-import": "off",

    "no-array-constructor": "error",
    "typescript/ban-ts-comment": "error",
    "typescript/no-empty-object-type": "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-namespace": "error",
    "typescript/no-require-imports": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/no-unsafe-argument": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-function-type": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/no-misused-promises": "error",
    "typescript/only-throw-error": "error",
    "typescript/prefer-promise-reject-errors": "error",
    "typescript/require-await": "error",
    "typescript/restrict-plus-operands": "error",
    "typescript/switch-exhaustiveness-check": "error",

    "typescript/consistent-type-definitions": ["error", "type"],
    "typescript/consistent-type-imports": "error",
    "typescript/explicit-function-return-type": [
      "error",
      { allowExpressions: true, allowTypedFunctionExpressions: true },
    ],
    eqeqeq: "error",
    "no-var": "error",
    "prefer-const": "error",
    "import/no-cycle": "error",
    "oxc/no-accumulating-spread": "error",
  },
  overrides: [
    {
      files: ["**/*.{test,spec}.{ts,tsx}"],
      plugins: ["vitest"],
    },
    {
      files: ["src/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/tests/**", "**/*.test.*", "**/*.spec.*"],
                message: "Production code must not import test code.",
              },
            ],
          },
        ],
      },
    },
  ],
});
