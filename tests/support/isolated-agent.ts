import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, vi } from "vitest";

// Setup modules run before suite imports. SDK default stores must not be
// shared across fork workers, even when a suite only uses in-memory sessions.
const previousDirectory = process.env.PI_CODING_AGENT_DIR;
const previousSessions = process.env.PI_CODING_AGENT_SESSION_DIR;
const directory = mkdtempSync(join(previousDirectory ?? tmpdir(), "pi-suite-"));

process.env.PI_CODING_AGENT_DIR = directory;
process.env.PI_CODING_AGENT_SESSION_DIR = join(directory, "sessions");

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValue(
        new Error("Network is disabled in deterministic tests"),
      ),
  );
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });

  if (previousDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousDirectory;

  if (previousSessions === undefined)
    delete process.env.PI_CODING_AGENT_SESSION_DIR;
  else process.env.PI_CODING_AGENT_SESSION_DIR = previousSessions;
});
