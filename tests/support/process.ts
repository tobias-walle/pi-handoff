import { spawnSync } from "node:child_process";

type ProcessOptions = Readonly<{
  cwd?: string;
  stdin?: string;
}>;

type ProcessResult = Readonly<{
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
}>;

export function runProcess(
  command: readonly string[],
  options: ProcessOptions = {},
): ProcessResult {
  const [executable, ...args] = command;

  if (executable === undefined) throw new Error("Missing process executable");

  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    input: options.stdin,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  });

  if (result.error !== undefined) throw result.error;

  if (result.signal !== null) {
    throw new Error(`Test process terminated by ${result.signal}`);
  }

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
