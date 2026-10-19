import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AssistantMessage,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Model,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type AgentToolResult,
  DefaultResourceLoader,
  type ExtensionAPI,
  type ExtensionCommandContextActions,
  type ExtensionError,
  type ExtensionFactory,
  type ExtensionUIContext,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import { onTestFinished } from "vitest";
import { fixtureTheme } from "./theme.ts";

export type TestExtensionAPI = Readonly<Omit<ExtensionAPI, "events">> &
  Readonly<{ events: Readonly<ExtensionAPI["events"]> }>;

type HarnessOptions = Readonly<{
  mode?: "tui" | "rpc" | "json" | "print";
  hasUI?: boolean;
  response?: string;
  noExtensions?: boolean;
  tools?: readonly string[];
  directoryPrefix?: string;
  ui?: Readonly<Partial<Omit<ExtensionUIContext, "theme">>>;
  commandActions?: Readonly<ExtensionCommandContextActions>;
}>;

type ExtensionHarness = Readonly<{
  directory: string;
  session: AgentSession;
  ui: ExtensionUIContext;
  manager: SessionManager;
  notifications: readonly string[];
  statuses: ReadonlyMap<string, string | undefined>;
  reasoningLevels: readonly (string | undefined)[];
  command: (name: string, args?: string) => Promise<void>;
  tool: (
    name: string,
    input: Readonly<Record<string, unknown>>,
  ) => Promise<AgentToolResult<unknown>>;
  dispose: () => Promise<void>;
}>;

const physicalModel: Model<"openai-completions"> = {
  id: "physical",
  provider: "fixture",
  name: "Physical",
  api: "openai-completions",
  baseUrl: "http://unused.invalid",
  reasoning: true,
  input: ["text"],
  contextWindow: 1000,
  maxTokens: 100,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

/** Real registration, dispatch and session state, with no live stores or network. */
export async function createExtensionHarness(
  factory: ExtensionFactory,
  options: HarnessOptions = {},
): Promise<ExtensionHarness> {
  const reasoningLevels: (string | undefined)[] = [];
  const directory = mkdtempSync(
    join(tmpdir(), options.directoryPrefix ?? "pi-extension-"),
  );
  const state: { session?: AgentSession } = {};
  let disposed = false;

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    try {
      await state.session?.extensionRunner.emit({
        type: "session_shutdown",
        reason: "quit",
      });
      await state.session?.abort();
    } finally {
      state.session?.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  };

  // Register before loading: failed setup and failed assertions still clean up.
  onTestFinished(dispose);
  const settings = SettingsManager.inMemory({
    defaultProvider: "fixture",
    defaultModel: "physical",
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager: settings,
    noExtensions: options.noExtensions ?? true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      (pi: Readonly<Pick<ExtensionAPI, "registerProvider">>) => {
        pi.registerProvider("fixture", {
          api: "openai-completions",
          apiKey: "fixture",
          baseUrl: "http://unused.invalid",
          models: [physicalModel],
          streamSimple(
            model: unknown,
            context: unknown,
            request: Readonly<{ reasoning?: string }> | undefined,
          ) {
            void model;
            void context;
            reasoningLevels.push(request?.reasoning);
            if (options.response === undefined) {
              throw new Error(
                "Unexpected model request: supply a fixture response in this test",
              );
            }
            const stream = createAssistantMessageEventStream();
            stream.push({
              type: "done",
              reason: "stop",
              message: assistantMessage(options.response),
            });
            stream.end();
            return stream;
          },
        });
      },
      factory,
    ],
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  if (loaded.errors.length > 0) throw new Error(JSON.stringify(loaded.errors));

  // Registration refreshes catalogs in the background. In-memory stores prevent
  // those writes from recreating a directory after automatic test disposal.
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const manager = SessionManager.inMemory(directory);
  const { session } = await createAgentSession({
    cwd: directory,
    agentDir: directory,
    resourceLoader: loader,
    settingsManager: settings,
    sessionManager: manager,
    modelRuntime,
    model: physicalModel,
    tools: [...(options.tools ?? [])],
  });
  state.session = session;
  const runner = session.extensionRunner;
  const notifications: string[] = [];
  const statuses = new Map<string, string | undefined>();
  const defaults: ExtensionUIContext = {
    ...runner.getUIContext(),
    theme: fixtureTheme,
    notify: (message) => {
      notifications.push(message);
    },
    setStatus: (key, text) => {
      statuses.set(key, text);
    },
    ...options.ui,
  };
  await session.bindExtensions({
    mode: options.mode ?? "print",
    ...(options.commandActions === undefined
      ? {}
      : { commandContextActions: options.commandActions }),
    ...(options.hasUI === true ? { uiContext: defaults } : {}),
    onError: (error: Readonly<ExtensionError>) => {
      throw new Error(error.error);
    },
  });

  return {
    directory,
    session,
    ui: defaults,
    manager,
    notifications,
    statuses,
    reasoningLevels,
    async command(name, args = ""): Promise<void> {
      const command = runner.getCommand(name);
      if (command === undefined) throw new Error(`Missing command: ${name}`);
      await command.handler(args, runner.createCommandContext());
    },
    tool(name, input): Promise<AgentToolResult<unknown>> {
      const definition = runner.getToolDefinition(name);
      if (definition === undefined) throw new Error(`Missing tool: ${name}`);
      const signal = new AbortController().signal;
      return definition.execute(
        "fixture-call",
        input,
        signal,
        undefined,
        runner.createToolContext("fixture-call", signal),
      );
    },
    dispose,
  };
}

export function assistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-completions",
    provider: "fixture",
    model: "physical",
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp: 1,
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
