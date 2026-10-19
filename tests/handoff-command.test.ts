import {
  type ExtensionCommandContext,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import handoffCommand from "../src/commands/handoff.ts";
import {
  assistantMessage,
  createExtensionHarness,
} from "./support/extension-harness.ts";
import { overlayHost } from "./support/ui.ts";

test("manual handoff places the generated draft through the fresh replacement UI", async () => {
  initTheme("dark", false);
  const host = overlayHost();
  const drafts: string[] = [];
  const notices: string[] = [];
  const replacement = await createExtensionHarness(() => {}, {
    mode: "tui",
    hasUI: true,
    ui: {
      setEditorText: (text) => {
        drafts.push(text);
      },
      notify: (text) => {
        notices.push(text);
      },
    },
  });
  const app = await createExtensionHarness(handoffCommand, {
    mode: "tui",
    hasUI: true,
    response: "Review the implementation in src/example.ts.",
    ui: {
      custom: host.custom,
      setEditorText: () => {
        throw new Error("Old UI used after replacement");
      },
      notify: () => {
        throw new Error("Old UI used after replacement");
      },
    },
    commandActions: {
      waitForIdle: () => Promise.resolve(),
      fork: () => Promise.reject(new Error("Unexpected fork")),
      navigateTree: () => Promise.reject(new Error("Unexpected navigation")),
      switchSession: () => Promise.reject(new Error("Unexpected switch")),
      reload: () => Promise.reject(new Error("Unexpected reload")),
      newSession: async (
        options:
          | Readonly<
              NonNullable<Parameters<ExtensionCommandContext["newSession"]>[0]>
            >
          | undefined,
      ) => {
        const context = {
          ...replacement.session.extensionRunner.createCommandContext(),
          sendMessage: () => Promise.reject(new Error("Unexpected send")),
          sendUserMessage: () => Promise.reject(new Error("Unexpected send")),
        };
        await options?.withSession?.(context);
        return { cancelled: false };
      },
    },
  });
  app.manager.appendMessage(assistantMessage("Completed implementation"));
  await app.command("handoff", "review the changes");
  expect(drafts).toEqual(["Review the implementation in src/example.ts."]);
  expect(notices).toEqual(["Handoff ready. Submit when ready."]);
  expect(replacement.session.messages).toEqual([]);
});

test.each([
  { hasUI: false, expected: [] },
  { hasUI: true, expected: ["No conversation to hand off"] },
])(
  "manual handoff refuses missing prerequisites: $expected",
  async ({ hasUI, expected }) => {
    const app = await createExtensionHarness(handoffCommand, {
      mode: "tui",
      hasUI,
    });
    await app.command("handoff");
    expect(app.notifications).toEqual(expected);
    expect(app.reasoningLevels).toEqual([]);
  },
);

test("manual handoff keeps the source session when the replacement is cancelled", async () => {
  initTheme("dark", false);
  const host = overlayHost();
  const app = await createExtensionHarness(handoffCommand, {
    mode: "tui",
    hasUI: true,
    response: "Draft to review",
    ui: { custom: host.custom },
    commandActions: {
      waitForIdle: () => Promise.resolve(),
      fork: () => Promise.reject(new Error("Unexpected fork")),
      navigateTree: () => Promise.reject(new Error("Unexpected navigation")),
      switchSession: () => Promise.reject(new Error("Unexpected switch")),
      reload: () => Promise.reject(new Error("Unexpected reload")),
      newSession: () => Promise.resolve({ cancelled: true }),
    },
  });
  app.manager.appendMessage(assistantMessage("Completed work"));
  const sourceId = app.manager.getSessionId();
  const sourceBranch = app.manager.getBranch();
  await app.command("handoff");
  expect(app.notifications).toEqual(["New session cancelled"]);
  expect(app.manager.getSessionId()).toBe(sourceId);
  expect(app.manager.getBranch()).toEqual(sourceBranch);
});

test("manual handoff cancels the loader without replacing the session", async () => {
  initTheme("dark", false);
  const host = overlayHost();
  const app = await createExtensionHarness(handoffCommand, {
    mode: "tui",
    hasUI: true,
    ui: { custom: host.custom },
  });
  const response = Promise.withResolvers<ReturnType<typeof assistantMessage>>();
  vi.spyOn(
    app.session.extensionRunner.createContext().modelRegistry,
    "complete",
  ).mockReturnValue(response.promise);
  app.manager.appendMessage(assistantMessage("Completed work"));
  const command = app.command("handoff");
  await vi.waitFor(() => {
    expect(host.active()).toBe(true);
  });
  host.input("\u001B");
  await command;
  response.resolve(assistantMessage("Late draft"));
  await response.promise;
  expect(app.notifications).toEqual(["Cancelled"]);
  expect(host.active()).toBe(false);
});

test.each([
  { text: "", expected: "empty draft" },
  { text: "   ", expected: "empty draft" },
])(
  "reports unusable model output instead of opening a session: $text",
  async ({ text, expected }) => {
    initTheme("dark", false);
    const host = overlayHost();
    const app = await createExtensionHarness(handoffCommand, {
      mode: "tui",
      hasUI: true,
      response: text,
      ui: { custom: host.custom },
    });
    app.manager.appendMessage(assistantMessage("Completed work"));
    await app.command("handoff");
    expect(app.notifications.join(" ")).toContain(expected);
    expect(host.active()).toBe(false);
  },
);

test("reports generation failures instead of claiming cancellation", async () => {
  initTheme("dark", false);
  const host = overlayHost();
  const app = await createExtensionHarness(handoffCommand, {
    mode: "tui",
    hasUI: true,
    ui: { custom: host.custom },
  });
  vi.spyOn(
    app.session.extensionRunner.createContext().modelRegistry,
    "complete",
  ).mockRejectedValue(new Error("Fixture provider failed"));
  app.manager.appendMessage(assistantMessage("Completed work"));
  await app.command("handoff");
  expect(app.notifications).toEqual([
    "Handoff failed: Fixture provider failed",
  ]);
  expect(host.active()).toBe(false);
});

test("rejects unknown command options before any model call", async () => {
  const app = await createExtensionHarness(handoffCommand, {
    mode: "tui",
    hasUI: true,
  });
  await app.command("handoff", "--unknown");
  expect(app.notifications.join(" ")).toContain("Usage: /handoff");
  expect(app.reasoningLevels).toEqual([]);
});

test("RPC cannot open a custom terminal loader", async () => {
  const app = await createExtensionHarness(handoffCommand, {
    mode: "rpc",
    hasUI: true,
  });
  await app.command("handoff");
  expect(app.notifications).toEqual([
    "handoff requires interactive terminal mode",
  ]);
  expect(app.reasoningLevels).toEqual([]);
});

test("manual draft uses neutral instructions and supplies the conversation to the selected model", async () => {
  initTheme("dark", false);
  const host = overlayHost();
  const app = await createExtensionHarness(handoffCommand, {
    mode: "tui",
    hasUI: true,
    ui: { custom: host.custom },
  });
  const complete = vi
    .spyOn(
      app.session.extensionRunner.createContext().modelRegistry,
      "complete",
    )
    .mockResolvedValue(assistantMessage(""));
  app.manager.appendMessage(assistantMessage("HISTORY_MARKER"));
  await app.command("handoff", "Continue with tests");
  expect(complete).toHaveBeenCalledOnce();
  expect(JSON.stringify(complete.mock.calls)).toContain("HISTORY_MARKER");
  expect(JSON.stringify(complete.mock.calls)).toContain("Continue with tests");
  expect(JSON.stringify(complete.mock.calls)).not.toContain("/implement");
  expect(JSON.stringify(complete.mock.calls)).not.toContain("/plan");
});

test("shutdown cancels a draft without touching the invalidated UI", async () => {
  initTheme("dark", false);
  const host = overlayHost();
  const app = await createExtensionHarness(handoffCommand, {
    mode: "tui",
    hasUI: true,
    ui: { custom: host.custom },
  });
  const response = Promise.withResolvers<ReturnType<typeof assistantMessage>>();
  vi.spyOn(
    app.session.extensionRunner.createContext().modelRegistry,
    "complete",
  ).mockReturnValue(response.promise);
  app.manager.appendMessage(assistantMessage("Completed work"));
  const command = app.command("handoff");
  await vi.waitFor(() => {
    expect(host.active()).toBe(true);
  });
  await app.session.extensionRunner.emit({
    type: "session_shutdown",
    reason: "quit",
  });
  await command;
  expect(host.active()).toBe(false);
  expect(app.notifications).toEqual([]);
  response.resolve(assistantMessage("Late draft"));
});

test("a draft times out even when the provider ignores cancellation", async () => {
  initTheme("dark", false);
  const host = overlayHost();
  const app = await createExtensionHarness(handoffCommand, {
    mode: "tui",
    hasUI: true,
    ui: { custom: host.custom },
  });
  const response = Promise.withResolvers<ReturnType<typeof assistantMessage>>();
  vi.spyOn(
    app.session.extensionRunner.createContext().modelRegistry,
    "complete",
  ).mockReturnValue(response.promise);
  app.manager.appendMessage(assistantMessage("Completed work"));
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
  const command = app.command("handoff");
  await vi.waitFor(() => {
    expect(host.active()).toBe(true);
  });
  timeout.abort();
  await command;
  expect(host.active()).toBe(false);
  expect(app.notifications).toEqual([
    "Handoff failed: Draft generation timed out.",
  ]);
  response.resolve(assistantMessage("Late draft"));
});
