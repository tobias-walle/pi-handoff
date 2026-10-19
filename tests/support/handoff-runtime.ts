import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Api,
  type AssistantMessage,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Model,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type CreateAgentSessionRuntimeFactory,
  type ExtensionCommandContext,
  type ExtensionError,
  ModelRuntime,
  type ProviderModelConfig,
  SessionManager,
  type SessionStartEvent,
  SettingsManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
} from "@earendil-works/pi-coding-agent";
import { onTestFinished } from "vitest";
import handoffExtension from "../../src/tool.ts";
import type { TestExtensionAPI } from "./extension-harness.ts";
import { overlayHost } from "./ui.ts";

function fixtureAlternatives(missing: boolean): ProviderModelConfig[] {
  if (missing) return [];
  return [
    {
      id: "other/nested",
      name: "Alternative",
      reasoning: true,
      thinkingLevelMap: { xhigh: "xhigh", max: "max" },
      input: ["text"],
      contextWindow: 100000,
      maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
      id: "no-reasoning",
      name: "No reasoning",
      reasoning: false,
      input: ["text"],
      contextWindow: 100000,
      maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  ];
}

export const handoffPrompt =
  "/review Review src/example.ts. The previous task is complete.";

type RuntimeFixture = Readonly<{
  runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>>;
  host: ReturnType<typeof overlayHost>;
  requests: readonly (readonly unknown[])[];
  errors: readonly string[];
  finished: Promise<void>;
  cancelSwitch: (cancel: boolean) => void;
  selections: readonly { model: string; reasoning: string | undefined }[];
}>;

type RuntimeOptions = {
  overrides?: { model?: string | undefined; reasoning?: string | undefined };
  replacementModel?: "missing" | "unauthenticated";
  changeSelectionAfterSetup?: boolean;
};

export async function handoffRuntimeFixture(
  options: RuntimeOptions = {},
): Promise<RuntimeFixture> {
  const directory = mkdtempSync(join(tmpdir(), "pi-handoff-"));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  const host = overlayHost();
  const requests: unknown[][] = [];
  const errors: string[] = [];
  const selections: { model: string; reasoning: string | undefined }[] = [];
  let generation = 0;
  const finished = Promise.withResolvers<void>();
  let cancelSwitch = false;

  // Pi transfers the live mutable SessionManager to the replacement runtime.
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    agentDir,
    sessionManager,
    sessionStartEvent,
  }: Readonly<{
    cwd: string;
    agentDir: string;
    sessionManager: SessionManager;
    sessionStartEvent?: Readonly<SessionStartEvent>;
  }>) => {
    generation++;
    const isReplacement = generation > 1;
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsStore: new InMemoryModelsStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const services = await createAgentSessionServices({
      modelRuntime,
      cwd,
      agentDir,
      settingsManager: SettingsManager.inMemory({
        defaultProvider: "fixture",
        defaultModel: "fixture",
        defaultThinkingLevel: isReplacement ? "medium" : "low",
        modelThinkingLevels: { "fixture/other/nested": "high" },
        defaultTools: ["handoff"],
        compaction: { enabled: false },
        retry: { enabled: false },
      }),
      resourceLoaderOptions: {
        noSkills: true,
        noContextFiles: true,
        extensionFactories: [
          handoffExtension,
          (pi: TestExtensionAPI) => {
            pi.on("session_before_switch", () =>
              cancelSwitch ? { cancel: true } : undefined,
            );
            pi.registerCommand("review", {
              description: "Must not be expanded from handoff prompt text",
              handler: () =>
                Promise.reject(new Error("Unexpected command expansion")),
            });
            pi.registerProvider("fixture", {
              api: "openai-completions",
              ...(isReplacement &&
              options.replacementModel === "unauthenticated"
                ? {}
                : { apiKey: "fixture" }),
              baseUrl: "http://unused.invalid",
              models: [
                {
                  id: "fixture",
                  name: "Fixture",
                  reasoning: true,
                  input: ["text"],
                  contextWindow: 100000,
                  maxTokens: 1000,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                },
                ...fixtureAlternatives(
                  isReplacement && options.replacementModel === "missing",
                ),
              ],
              streamSimple(
                model: Model<Api>,
                context: Readonly<{ messages: readonly unknown[] }>,
                request: Readonly<{ reasoning?: string }> | undefined,
              ) {
                selections.push({
                  model: `${model.provider}/${model.id}`,
                  reasoning: request?.reasoning,
                });
                requests.push(structuredClone([...context.messages]));
                const first = requests.length === 1;
                const message: AssistantMessage = {
                  role: "assistant",
                  api: "openai-completions",
                  provider: "fixture",
                  model: "fixture",
                  content: first
                    ? [
                        {
                          type: "toolCall",
                          id: "handoff-1",
                          name: "handoff",
                          arguments: {
                            prompt: handoffPrompt,
                            ...(options.overrides?.model === undefined
                              ? {}
                              : { model: options.overrides.model }),
                            ...(options.overrides?.reasoning === undefined
                              ? {}
                              : { reasoning: options.overrides.reasoning }),
                          },
                        },
                      ]
                    : [{ type: "text", text: "Next task started" }],
                  stopReason: first ? "toolUse" : "stop",
                  timestamp: Date.now(),
                  usage: {
                    input: 10,
                    output: 10,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 20,
                    cost: {
                      input: 0,
                      output: 0,
                      cacheRead: 0,
                      cacheWrite: 0,
                      total: 0,
                    },
                  },
                };
                const stream = createAssistantMessageEventStream();
                stream.push({
                  type: "done",
                  reason: first ? "toolUse" : "stop",
                  message,
                });
                stream.end();
                return stream;
              },
            });
            pi.registerProvider("no-auth", {
              api: "openai-completions",
              baseUrl: "http://unused.invalid",
              models: fixtureAlternatives(false),
            });
            if (options.changeSelectionAfterSetup === true)
              pi.on("session_start", () => {
                if (isReplacement) pi.setThinkingLevel("high");
              });
          },
        ],
      },
    });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: directory,
    agentDir: directory,
    sessionManager: SessionManager.create(
      directory,
      join(directory, "sessions"),
    ),
  });
  onTestFinished(async () => {
    await runtime.dispose();
  });

  const bind = async (session: AgentSession): Promise<void> => {
    await session.bindExtensions({
      mode: "tui",
      uiContext: {
        ...session.extensionRunner.getUIContext(),
        custom: host.custom,
        setStatus() {},
        notify: (message) => {
          throw new Error(message);
        },
      },
      onError: (error: Readonly<ExtensionError>) => {
        errors.push(error.error);
        finished.reject(new Error(error.error));
      },
      commandContextActions: {
        waitForIdle: () => session.waitForIdle(),
        newSession: async (
          replacementOptions:
            | Readonly<
                NonNullable<
                  Parameters<ExtensionCommandContext["newSession"]>[0]
                >
              >
            | undefined,
        ) => {
          try {
            const result = await runtime.newSession(replacementOptions);
            finished.resolve();
            return result;
          } catch (error) {
            finished.reject(error);
            throw error;
          }
        },
        fork: () => Promise.reject(new Error("Unexpected fork")),
        navigateTree: () => Promise.reject(new Error("Unexpected navigation")),
        switchSession: () => Promise.reject(new Error("Unexpected switch")),
        reload: () => Promise.reject(new Error("Unexpected reload")),
      },
    });
  };

  runtime.setRebindSession(bind);
  runtime.setBeforeSessionInvalidate(() => {
    if (host.active())
      throw new Error("Host overlay must close before invalidation");
  });
  await bind(runtime.session);
  return {
    runtime,
    host,
    requests,
    errors,
    finished: finished.promise,
    selections,
    cancelSwitch: (value) => {
      cancelSwitch = value;
    },
  };
}
