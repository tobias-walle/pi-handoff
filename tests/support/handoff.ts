import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  ExtensionCommandContext,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import handoffExtension from "../../src/tool.ts";
import {
  type TestExtensionAPI,
  createExtensionHarness,
} from "./extension-harness.ts";
import { required } from "./ui.ts";

type HandoffState = {
  mode: "tui" | "print";
  queued: boolean;
  stale: boolean;
  cancelled: boolean;
  createError: boolean;
  sendError: boolean;
  switches: number;
  parentSession: string | undefined;
};

type Fixture = Readonly<{
  tool: ToolDefinition;
  manager: Awaited<ReturnType<typeof createExtensionHarness>>["manager"];
  replacement: Awaited<ReturnType<typeof createExtensionHarness>>["manager"];
  state: HandoffState;
  controller: AbortController;
  notifications: readonly string[];
  submitted: readonly Readonly<{ prompt: unknown; options: unknown }>[];
  dispatches: readonly Readonly<{ text: string; options: unknown }>[];
  emit: (
    event:
      | "input"
      | "before_agent_start"
      | "session_before_tree"
      | "session_shutdown"
      | "error"
      | "aborted",
  ) => Promise<unknown>;
  execute: (
    prompt?: string,
    title?: string,
  ) => Promise<AgentToolResult<unknown>>;
  finish: () => Promise<void>;
  runCommand: (id: string) => Promise<void>;
}>;

export function handoffAssistant(
  calls: readonly string[] = ["call-1"],
): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-completions",
    provider: "fixture",
    model: "fixture",
    content: calls.map((id) => ({
      type: "toolCall",
      id,
      name: "handoff",
      arguments: { prompt: "Next task" },
    })),
    stopReason: "toolUse",
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

export async function handoffFixture(): Promise<Fixture> {
  const replacement = await createExtensionHarness(handoffExtension);
  const idle = Promise.withResolvers<void>();
  const controller = new AbortController();
  const notifications: string[] = [];
  const submitted: { prompt: unknown; options: unknown }[] = [];
  const dispatches: { text: string; options: unknown }[] = [];
  const state: HandoffState = {
    mode: "tui",
    queued: false,
    stale: false,
    cancelled: false,
    createError: false,
    sendError: false,
    switches: 0,
    parentSession: undefined,
  };
  let commandRun: Promise<void> | undefined;

  const assertLive = (): void => {
    if (state.stale) throw new Error("Old runtime used after replacement");
  };

  const app = await createExtensionHarness(
    (pi: TestExtensionAPI) => {
      handoffExtension({
        ...pi,
        appendEntry: (type, data) => {
          assertLive();
          pi.appendEntry(type, data);
        },
        sendUserMessage: (text: unknown, options: unknown) => {
          if (typeof text !== "string")
            throw new Error("Expected command dispatch text");
          dispatches.push({ text, options });
          const [name, id] = text.slice(1).split(" ");
          commandRun = required(
            app.session.extensionRunner.getCommand(name ?? ""),
          ).handler(id ?? "", context);
        },
      });
    },
    { mode: "tui", hasUI: true },
  );
  const runner = app.session.extensionRunner;
  app.manager.appendMessage(handoffAssistant());
  const context: ExtensionCommandContext & ExtensionToolContext = {
    ...runner.createCommandContext(),
    ...runner.createToolContext("call-1", controller.signal),
    get mode() {
      return state.mode;
    },
    get ui() {
      assertLive();
      return {
        ...app.ui,
        notify: (text: string) => {
          notifications.push(text);
        },
      };
    },
    get sessionManager() {
      assertLive();
      return app.manager;
    },
    hasPendingMessages: () => state.queued,
    waitForIdle: () => idle.promise,
    async newSession(
      options:
        | Readonly<
            NonNullable<Parameters<ExtensionCommandContext["newSession"]>[0]>
          >
        | undefined,
    ): Promise<{ cancelled: boolean }> {
      state.switches++;
      if (state.createError) throw new Error("Session creation failed");
      if (state.cancelled) return { cancelled: true };
      state.parentSession = options?.parentSession;
      await runner.emit({ type: "session_shutdown", reason: "new" });
      state.stale = true;
      await options?.setup?.(replacement.manager);
      await replacement.session.extensionRunner.emit({
        type: "session_start",
        reason: "new",
      });
      await options?.withSession?.({
        ...replacement.session.extensionRunner.createCommandContext(),
        get model() {
          return replacement.session.model;
        },
        get thinkingLevel() {
          return replacement.session.thinkingLevel;
        },
        sendMessage: () =>
          Promise.reject(new Error("Unexpected custom message")),
        sendUserMessage: (prompt: unknown, sendOptions: unknown) => {
          if (state.sendError)
            return Promise.reject(new Error("Prompt submission failed"));
          submitted.push({ prompt, options: sendOptions });
          return Promise.resolve();
        },
      });
      return { cancelled: false };
    },
  };
  const tool = required(runner.getToolDefinition("handoff"));
  return {
    tool,
    manager: app.manager,
    replacement: replacement.manager,
    state,
    controller,
    notifications,
    submitted,
    dispatches,
    emit: (event) => {
      if (event === "input")
        return runner.emitInput("Changed", undefined, "interactive");
      if (event === "before_agent_start")
        return runner.emitBeforeAgentStart(
          { messageType: "user", prompt: "Changed" },
          {
            cwd: app.directory,
          },
        );
      if (event === "session_before_tree")
        return runner.emit({
          type: "session_before_tree",
          signal: controller.signal,
          preparation: {
            targetId: "fixture",
            oldLeafId: null,
            commonAncestorId: null,
            entriesToSummarize: [],
            userWantsSummary: false,
          },
        });
      if (event === "session_shutdown")
        return runner.emit({ type: "session_shutdown", reason: "quit" });
      return runner.emitBoundary(
        { type: "agent_before_settle", outcome: event },
        () => ({
          contextEntries: [],
          contextMessages: [],
          llmMessages: [],
          pendingMessages: [],
          canContinue: false,
        }),
      );
    },
    execute: (prompt, title) =>
      tool.execute(
        "call-1",
        { prompt: prompt ?? "Next task", title },
        controller.signal,
        undefined,
        context,
      ),
    async finish(): Promise<void> {
      idle.resolve();
      await commandRun;
    },
    runCommand: (id) =>
      required(runner.getCommand("handoff-run")).handler(id, context),
  };
}
