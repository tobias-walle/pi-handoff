import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";
import { gitFiles, runStage } from "./check-process.ts";

export const root = fileURLToPath(new URL("../", import.meta.url));

export type Step = {
  name: string;
  command: string[];
  filters: string[];
  include: string[];
  exclude?: string[];
  stage?: number;
  cwd?: string;
};

const inputs = ["**/*.ts", "**/*.json", ".oxfmtrc.json", "package-lock.json"];
const steps: Step[] = [
  {
    name: "format:check",
    command: ["npm", "run", "format:check"],
    filters: ["format"],
    include: ["**/*", ".*", ".github/**"],
    stage: 0,
  },
  {
    name: "lint",
    command: ["npm", "run", "lint"],
    filters: ["lint"],
    include: inputs,
    stage: 0,
  },
  {
    name: "typecheck",
    command: ["npm", "run", "typecheck"],
    filters: ["typecheck"],
    include: inputs,
    stage: 1,
  },
  {
    name: "test",
    command: ["npm", "run", "test"],
    filters: ["test"],
    include: inputs,
    stage: 1,
  },
];

await main();

async function main(): Promise<void> {
  try {
    await check(process.argv.slice(2).filter((arg) => arg !== "--"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

async function check(args: readonly string[]): Promise<void> {
  const selected = selectSteps(args);
  const files = await gitFiles(root);
  const hashes = await Promise.all(
    selected.map((step) => hashInputs(step, files)),
  );
  const pending: Step[] = [];

  for (const [index, step] of selected.entries()) {
    if (
      !args.includes("--force") &&
      (await cached(step.name)) === hashes[index]
    ) {
      console.log(`CACHED ${step.name}`);
    } else {
      pending.push(step);
    }
  }

  const stages = [...new Set(pending.map((step) => step.stage ?? 0))].toSorted(
    (a, b) => a - b,
  );

  for (const stage of stages) {
    await runStage(
      pending.filter((step) => (step.stage ?? 0) === stage),
      root,
      args.includes("--verbose"),
    );
  }

  const finalFiles = await gitFiles(root);
  const finalHashes = await Promise.all(
    selected.map((step) => hashInputs(step, finalFiles)),
  );

  if (hashes.some((hash, index) => hash !== finalHashes[index])) {
    throw new Error("Check inputs changed during execution. Rerun the gate.");
  }

  await mkdir(new URL("../.check-cache/", import.meta.url), {
    recursive: true,
  });
  await Promise.all(
    selected.map((step, index) =>
      writeFile(cachePath(step.name), `${hashes[index]}\n`),
    ),
  );
  console.log("All checks passed");
}

function selectSteps(args: readonly string[]): Step[] {
  const filters = args.filter((arg) => !arg.startsWith("--"));
  const unknown = args.some(
    (arg) => arg.startsWith("--") && !["--force", "--verbose"].includes(arg),
  );

  const matches = (step: Step, filter: string): boolean =>
    step.name.startsWith(filter) || step.filters.includes(filter);

  if (
    unknown ||
    filters.some((filter) => !steps.some((step) => matches(step, filter)))
  ) {
    throw new Error(
      "Usage: check [format|lint|typecheck|test] [--force] [--verbose]",
    );
  }

  return steps.filter(
    (step) =>
      filters.length === 0 || filters.some((filter) => matches(step, filter)),
  );
}

async function hashInputs(
  step: Step,
  files: readonly string[],
): Promise<string> {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify([
      "check-v1",
      process.versions.node,
      process.platform,
      process.arch,
      step,
    ]),
  );

  for (const path of files) {
    const runner = path.startsWith("scripts/check");
    const included =
      runner || step.include.some((pattern) => matchesGlob(path, pattern));
    const excluded =
      step.exclude?.some((pattern) => matchesGlob(path, pattern)) ?? false;

    if (!included || excluded) continue;

    hash.update(path).update("\0");
    hash
      .update(await readFile(new URL(path, new URL("../", import.meta.url))))
      .update("\0");
  }

  return hash.digest("hex");
}

function cachePath(name: string): URL {
  return new URL(
    `../.check-cache/${name.replaceAll(":", "-")}.sha256`,
    import.meta.url,
  );
}

async function cached(name: string): Promise<string | undefined> {
  try {
    return (await readFile(cachePath(name), "utf8")).trim();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;

    throw error;
  }
}
