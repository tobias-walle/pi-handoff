import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { Step } from "./check.ts";

export function gitFiles(root: string): Promise<string[]> {
  const result = spawnSync("git", ["ls-files", "-coz", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.error !== undefined) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr || "Failed to list git files");

  return Promise.resolve(
    [...new Set(result.stdout.split("\0").filter(Boolean))].toSorted(),
  );
}

export async function runStage(
  steps: readonly Step[],
  root: string,
  verbose: boolean,
): Promise<void> {
  const controller = new AbortController();
  const results = await Promise.all(
    steps.map(async (step) => {
      const passed = await runStep(step, root, verbose, controller.signal);

      if (!passed) controller.abort();

      return passed;
    }),
  );

  if (results.some((passed) => !passed)) throw new Error("Checks failed");
}

function runStep(
  step: Step,
  root: string,
  verbose: boolean,
  signal: AbortSignal,
): Promise<boolean> {
  const [command, ...args] = step.command;

  if (command === undefined)
    throw new Error(`Missing command for ${step.name}`);

  const start = performance.now();
  const child = spawn(command, args, {
    cwd: resolve(root, step.cwd ?? "."),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    shell: process.platform === "win32",
  });
  let output = "";

  function report(chunk: Buffer): void {
    output += chunk.toString();

    if (verbose) process.stderr.write(chunk);
  }

  child.stdout.on("data", report);
  child.stderr.on("data", report);

  function cancel(): void {
    if (child.pid === undefined) return;

    try {
      if (process.platform === "win32") child.kill();
      else process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ESRCH")
      )
        throw error;
    }
  }

  signal.addEventListener("abort", cancel, { once: true });

  return new Promise((done) => {
    child.once("error", (error) => {
      output += `${error.message}\n`;
    });
    child.once("close", (code) => {
      signal.removeEventListener("abort", cancel);

      if (code !== 0 && !verbose) process.stderr.write(output);

      console.log(
        `${code === 0 ? "PASS" : "FAIL"} ${step.name} ${((performance.now() - start) / 1000).toFixed(2)}s`,
      );
      done(code === 0);
    });
  });
}
