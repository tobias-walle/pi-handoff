import { expect, test } from "vitest";
import handoffExtension from "../src/tool.ts";
import { createExtensionHarness } from "./support/extension-harness.ts";
import { customEntries } from "./support/session-entries.ts";

test.each(["startup", "reload", "resume", "fork"] as const)(
  "does not replay an unconsumed persisted request on %s",
  async (reason) => {
    const app = await createExtensionHarness(handoffExtension);
    app.manager.appendCustomEntry("handoff-selection", {
      id: "persisted",
      sessionId: app.manager.getSessionId(),
      selection: {
        provider: "fixture",
        modelId: "physical",
        reasoning: "high",
      },
    });
    app.session.setThinkingLevel("low");
    await app.session.extensionRunner.emit({ type: "session_start", reason });
    expect(app.session.thinkingLevel).toBe("low");
    expect(customEntries(app.manager, "handoff-selection")).toHaveLength(1);
  },
);

test.each([
  { id: "malformed", sessionId: 5, selection: {} },
  {
    id: "foreign",
    sessionId: "another-session",
    selection: { provider: "fixture", modelId: "physical", reasoning: "high" },
  },
])("ignores malformed or foreign setup data: $id", async (data) => {
  const app = await createExtensionHarness(handoffExtension);
  app.manager.appendCustomEntry("handoff-selection", data);
  app.session.setThinkingLevel("low");
  await app.session.extensionRunner.emit({
    type: "session_start",
    reason: "new",
  });
  expect(app.session.thinkingLevel).toBe("low");
  expect(customEntries(app.manager, "handoff-selection")).toHaveLength(1);
});
