import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished, test } from "vitest";
import { runProcess } from "./support/process.ts";

function runnerFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-check-runner-"));
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true });
  });
  execFileSync("git", ["init", "--quiet", root]);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, ".github"));

  for (const name of ["check.ts", "check-process.ts"]) {
    copyFileSync(
      fileURLToPath(new URL(`../scripts/${name}`, import.meta.url)),
      join(root, "scripts", name),
    );
  }

  writeFileSync(join(root, ".gitignore"), ".check-cache/\noutput/\n");
  writeFileSync(join(root, ".oxfmtrc.json"), "{}\n");
  writeFileSync(join(root, ".github", "checks.yml"), "name: checks\n");
  writeFileSync(
    join(root, "probe.js"),
    `import { existsSync, mkdirSync, writeFileSync } from "node:fs";
mkdirSync("output", { recursive: true });
writeFileSync("output/ran", "yes");
if (existsSync("fail")) process.exitCode = 1;
`,
  );
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      type: "module",
      scripts: {
        "format:check": "node probe.js",
        lint: "node probe.js",
        typecheck: "node probe.js",
        test: "node probe.js",
      },
    }),
  );
  return root;
}

function check(root: string, ...args: string[]): ReturnType<typeof runProcess> {
  return runProcess([process.execPath, "scripts/check.ts", ...args], {
    cwd: root,
  });
}

test("check caches unchanged inputs, includes hidden config, and supports forced runs", () => {
  const root = runnerFixture();
  const source = readFileSync(join(root, "probe.js"), "utf8");
  expect(check(root, "format", "--force").exitCode).toBe(0);
  expect(check(root, "format").stdout.toString()).toContain(
    "CACHED format:check",
  );
  writeFileSync(join(root, ".oxfmtrc.json"), '{"tabWidth":2}\n');
  expect(check(root, "format").stdout.toString()).toContain(
    "PASS format:check",
  );
  writeFileSync(join(root, ".github", "checks.yml"), "name: changed\n");
  expect(check(root, "format").stdout.toString()).toContain(
    "PASS format:check",
  );
  expect(check(root, "format", "--force").stdout.toString()).toContain(
    "PASS format:check",
  );
  expect(readFileSync(join(root, "probe.js"), "utf8")).toBe(source);
});

test("check rejects unknown filters and does not publish failed-stage cache receipts", () => {
  const root = runnerFixture();
  writeFileSync(join(root, "fail"), "fail");
  expect(check(root, "format", "--force").exitCode).toBe(1);
  expect(existsSync(join(root, ".check-cache", "format-check.sha256"))).toBe(
    false,
  );
  expect(check(root, "missing").exitCode).toBe(1);
  expect(check(root, "--unknown").exitCode).toBe(1);
});
