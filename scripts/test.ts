import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Set isolation before loading the SDK, including worker process imports.
const directory = mkdtempSync(join(tmpdir(), "pi-test-agent-"));

try {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
      ),
      "run",
      "--config",
      "scripts/vitest.config.ts",
      ...process.argv.slice(2),
    ],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: {
        ...process.env,
        PI_TEST_CACHE_DIR: join(directory, "vite-cache"),
        PI_CODING_AGENT_DIR: directory,
        PI_CODING_AGENT_SESSION_DIR: join(directory, "sessions"),
        PI_OFFLINE: "1",
        PI_SKIP_VERSION_CHECK: "1",
        PI_TELEMETRY: "0",
      },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );

  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      resolve(code ?? 1);
    });
  });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
