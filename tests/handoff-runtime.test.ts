import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import {
  handoffPrompt,
  handoffRuntimeFixture,
} from "./support/handoff-runtime.ts";
import { required } from "./support/ui.ts";

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
