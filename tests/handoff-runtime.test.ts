import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import {
  handoffPrompt,
  handoffRuntimeFixture,
} from "./support/handoff-runtime.ts";
import { customEntries } from "./support/session-entries.ts";
import { required } from "./support/ui.ts";

function sourceSessionId(manager: SessionManager): string {
  const data: unknown = required(
    customEntries(manager, "handoff-tool")[0],
  ).data;
  if (
    typeof data !== "object" ||
    data === null ||
    !("sourceSessionId" in data) ||
    typeof data.sourceSessionId !== "string"
  )
    throw new Error("Missing handoff source session id");
  return data.sourceSessionId;
}

test("successive handoffs stay siblings and retain their exact predecessors", async () => {
  const f = await handoffRuntimeFixture({ handoffCount: 3 });
  const original = f.runtime.session;
  const originalFile = required(original.sessionFile);
  const originalId = original.sessionId;
  await original.prompt("Start a chain of handoffs");
  await f.finished;

  expect(f.errors).toEqual([]);
  expect(f.requests).toHaveLength(4);
  const manager = f.runtime.session.sessionManager;
  const sessions = await SessionManager.list(
    manager.getCwd(),
    manager.getSessionDir(),
  );
  expect(sessions).toHaveLength(4);
  const successors = new Map<string, string>();
  for (const session of sessions.filter((item) => item.id !== originalId)) {
    const persisted = SessionManager.open(session.path);
    expect(persisted.getHeader()?.parentSession).toBe(originalFile);
    successors.set(sourceSessionId(persisted), session.id);
  }
  const secondId = required(successors.get(originalId));
  const thirdId = required(successors.get(secondId));
  expect(successors.get(thirdId)).toBe(f.runtime.session.sessionId);
});

test("handoff crosses real runtimes without old context, extra requests, or command expansion", async () => {
  const f = await handoffRuntimeFixture();
  const original = f.runtime.session;
  const originalId = original.sessionId;
  const originalFile = required(original.sessionFile);
  await original.prompt(
    "Finish the task, then explicitly start a new context to review it. OLD_CONTEXT_MARKER",
  );
  await f.finished;
  expect(f.errors).toEqual([]);
  expect(f.runtime.session.sessionId).not.toBe(originalId);
  expect(f.runtime.session.sessionManager.getHeader()?.parentSession).toBe(
    originalFile,
  );
  expect(f.requests).toHaveLength(2);
  const next = JSON.stringify(f.requests[1]);
  expect(next).toContain(handoffPrompt);
  expect(next).not.toContain("OLD_CONTEXT_MARKER");
  expect(next).not.toContain("handoff-run");
  expect(f.runtime.session.getLastAssistantText()).toBe("Next task started");
  const source = SessionManager.open(originalFile);
  expect(
    source.getBranch().findLast((entry) => entry.type === "message"),
  ).toMatchObject({
    type: "message",
    message: { role: "toolResult", toolName: "handoff", isError: false },
  });
});
