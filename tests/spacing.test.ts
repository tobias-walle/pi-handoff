import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import { runProcess } from "./support/process.ts";
import { required } from "./support/ui.ts";

const separated = [
  'test("one", () => {});\ntest("two", () => {});',
  'test.skip("one", () => {});\ntest.each([1])("two", () => {});',
  'beforeEach(() => {});\nit("works", () => {});',
  'describe("group", () => {\nit("one", () => {});\nit("two", () => {});\n});',
  "type One = string;\ntype Two = number;",
  "function one() {}\nfunction two() {}",
  "class One {}\nclass Two {}",
  "interface One {}\ninterface Two {}",
  "enum One { First }\nuse(One);",
  "declare function one(): void;\ndeclare function two(): void;",
  "export default function one() {}\nuse(one);",
  "export default class One {}\nuse(One);",
  "const one = () => {};\nconst two = function () {};",
  "const value = 1;\nconst run = () => value;",
  "function outer() {\nconst value = read();\nfunction inner() {}\nuse(value);\n}",
  'describe("group", () => {\nconst value = 1;\nbeforeEach(() => {});\nuse(value);\n});',
  "class Example {\nfield = () => {};\nother = 2;\n}",
  "class Example {\none() {}\ntwo() {}\n}",
  "export type One = string;\nexport function two() {}",
  "function one() {} function two() {}",
  'test("one", () => {});\n/* second\n\ncase */\ntest("two", () => {});',
  'test("one", () => {}); /* trailing\n\ncomment */\ntest("two", () => {});',
  "class Example {\nfield = 1;\nmethod() {}\nother = 2;\n}",
  "namespace Example {\ntype One = string;\ntype Two = number;\n}",
  'import { test } from "vitest";\n\ntest("one", () => {});\ntest("two", () => {});',
  'import { test } from "bun:test";\n\ntest("one", () => {});\ntest("two", () => {});',
  'import { test } from "vitest";\n\ntest("one", () => {});\n/* second\n\ncase */\ntest("two", () => {});',
  'import { test as check } from "vitest";\n\ncheck("one", () => {});\ncheck("two", () => {});\nfinish();',
  'import { beforeEach as setup } from "bun:test";\n\nsetup(() => {});\nfinish();',
  'test("one", () => {}); test("two", () => {});',
  'test["skip"]("one", () => {});\ntest["each"]([1])("two", () => {});',
  'const test = customTest;\n\ntest("one", () => {});\ntest("two", () => {});',
];
const grouped = [
  "const one = 1;\nuse(one);",
  "function run() {\nconst one = 1;\nreturn one;\n}",
  "if (ready) { run(); }\nfinish();",
  "start();\nfor (const item of items) { use(item); }",
  "switch (kind) { case 1: const value = read();\nreturn value; }",
  "class Example { static {\nconst value = read();\nuse(value);\n} }",
  "const element = <div />;\nrender(element);",
  "function choose(members, section) {\nlet selected;\nfor (const member of members) {\nif (member.name === section) {\nselected = member;\nbreak;\n}\n}\nreturn selected;\n}",
  "function run() {\nupdate();\nreturn value;\n}",
  "function run() {\nconst error = new Error();\nthrow error;\n}",
  "for (const item of items) {\nrecord(item);\ncontinue;\n}",
  "function run() {\nconst value = read();\n\nuse(value);\n\nreturn value;\n}",
  'import { one } from "one";\nimport { two } from "two";',
  "const one = 1;\nlet two = 2;",
  "export const one = 1;\nconst two = 2;",
  "start();\nfinish();",
  "value.one = 1;\nvalue.two = 2;",
  "expect(one).toBe(1);\nexpect(two).toBe(2);",
  'test("one", () => {});\n\ntest("two", () => {});',
  "if (ready) { run(); } else { wait(); }",
  "try { run(); } catch { recover(); } finally { close(); }",
  "type Example = { one: string; two: number };",
  "class Example {\none = 1;\ntwo = 2;\n}",
  'const text = `test("one");\ntest("two");`; ',
  '// test("one");\n// test("two");',
];
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const config = join(packageRoot, "scripts/spacing.config.ts");
const oxlint = join(packageRoot, "node_modules/oxlint/bin/oxlint");

test("Oxlint rejects logical boundaries, preserves groups, and fixes only whitespace", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-spacing-rules-"));
  const sources = [...separated, ...grouped];
  const files = Array.from(sources.keys(), (index) =>
    join(root, `case-${index}.test.tsx`),
  );

  try {
    sources.forEach((source, index) => {
      writeFileSync(required(files[index]), source);
    });

    const result = runOxlint(files);
    const diagnostics = parseSpacingDiagnostics(result.stdout.toString());

    expect(result.exitCode).toBe(1);

    for (const [index, source] of sources.entries()) {
      const fileDiagnostics = diagnostics.filter(
        (diagnostic) => resolve(tmpdir(), diagnostic.filename) === files[index],
      );

      expect(fileDiagnostics.length > 0).toBe(index < separated.length);
      expect(readFileSync(required(files[index]), "utf8")).toBe(source);
    }

    expect(
      diagnostics.every(
        (diagnostic) => diagnostic.code === "readable(logical-spacing)",
      ),
    ).toBe(true);
    expect(runOxlint(files, true).exitCode).toBe(0);

    const fixed = files.map((file) => readFileSync(file, "utf8"));

    for (const [index, source] of fixed.entries()) {
      expect(tokens(source)).toEqual(tokens(required(sources[index])));
    }

    expect(fixed.slice(separated.length)).toEqual(grouped);
    expect(runOxlint(files).exitCode).toBe(0);
    expect(runOxlint(files, true).exitCode).toBe(0);
    expect(files.map((file) => readFileSync(file, "utf8"))).toEqual(fixed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Oxlint keeps comments attached, preserves CRLF, and checks JavaScript", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-spacing-comments-"));
  const files = ["example.js", "example.test.js", "example.spec.ts"].map(
    (name) => join(root, name),
  );
  const source =
    'test("one", () => {}); // trailing\r\n// second case\r\ntest("two", () => {});';

  try {
    for (const file of files) {
      writeFileSync(file, source);
    }

    expect(runOxlint(files).exitCode).toBe(1);
    expect(runOxlint(files, true).exitCode).toBe(0);

    for (const file of files) {
      expect(readFileSync(file, "utf8")).toBe(
        'test("one", () => {}); // trailing\r\n\r\n// second case\r\ntest("two", () => {});',
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function runOxlint(
  files: readonly string[],
  fix = false,
): ReturnType<typeof runProcess> {
  return runProcess(
    [
      "node",
      oxlint,
      "--config",
      config,
      "--disable-nested-config",
      "--format",
      "json",
      ...(fix ? ["--fix"] : []),
      ...files,
    ],
    { cwd: tmpdir() },
  );
}

type SpacingDiagnostic = Readonly<{
  filename: string;
  code: string;
}>;

function parseSpacingDiagnostics(output: string): readonly SpacingDiagnostic[] {
  const schema = Type.Object({
    diagnostics: Type.Array(
      Type.Object({ filename: Type.String(), code: Type.String() }),
    ),
  });
  const report: unknown = JSON.parse(output);

  if (!Value.Check(schema, report)) {
    throw new Error("Unexpected Oxlint spacing report");
  }

  return report.diagnostics;
}

function tokens(source: string): string {
  return source.replaceAll(/\s+/gu, "");
}
