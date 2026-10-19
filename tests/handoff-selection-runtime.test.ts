import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import {
  handoffPrompt,
  handoffRuntimeFixture,
} from "./support/handoff-runtime.ts";
import { customEntries } from "./support/session-entries.ts";
import { required } from "./support/ui.ts";

function toolResults(manager: SessionManager): unknown[] {
  return manager
    .getBranch()
    .filter(
      (entry) =>
        entry.type === "message" && entry.message.role === "toolResult",
    );
}

const modelValues = [
  { value: undefined, expected: "fixture" },
  { value: "", expected: "fixture" },
  { value: "   ", expected: "fixture" },
  { value: "fixture/other/nested", expected: "other/nested" },
];
const reasoningValues = [
  { value: undefined, expected: "low" },
  { value: "", expected: "low" },
  { value: "   ", expected: "low" },
  { value: "high", expected: "high" },
];
const matrix = modelValues.flatMap((model) =>
  reasoningValues.map((reasoning) => ({
    overrides: { model: model.value, reasoning: reasoning.value },
    modelId: model.expected,
    reasoning: reasoning.expected,
  })),
);

test.each(matrix)(
  "inherits or overrides $overrides independently across real runtimes",
  async ({ overrides, modelId, reasoning }) => {
    const f = await handoffRuntimeFixture({ overrides });
    const original = f.runtime.session;
    await original.prompt(
      "Start a new context, using overrides only as explicitly requested.",
    );
    await f.finished;
    expect(f.errors).toEqual([]);
    expect(f.runtime.session.sessionId).not.toBe(original.sessionId);
    expect(f.selections).toEqual([
      { model: "fixture/fixture", reasoning: "low" },
      { model: `fixture/${modelId}`, reasoning },
    ]);
    expect(f.runtime.session.thinkingLevel).toBe(reasoning);
    const recovery = customEntries(
      f.runtime.session.sessionManager,
      "handoff-tool",
    );
    expect(recovery).toMatchObject([
      {
        data: {
          prompt: handoffPrompt,
          selection: { provider: "fixture", modelId, reasoning },
        },
      },
    ]);
  },
);

test.each([
  { reasoning: "off", wire: undefined },
  { reasoning: "minimal", wire: "minimal" },
  { reasoning: "medium", wire: "medium" },
  { reasoning: "xhigh", wire: "xhigh" },
  { reasoning: "max", wire: "max" },
])(
  "delivers with supported explicit reasoning $reasoning",
  async ({ reasoning, wire }) => {
    const f = await handoffRuntimeFixture({
      overrides: { model: "fixture/other/nested", reasoning },
    });
    await f.runtime.session.prompt(
      "Start a new context with the requested selection.",
    );
    await f.finished;
    expect(f.runtime.session.thinkingLevel).toBe(reasoning);
    expect(f.selections.at(-1)).toEqual({
      model: "fixture/other/nested",
      reasoning: wire,
    });
  },
);

test.each([
  { overrides: { model: "other" }, error: "provider/model-id" },
  { overrides: { model: "fixture/absent" }, error: "Unknown handoff model" },
  { overrides: { model: "fixture/" }, error: "provider/model-id" },
  {
    overrides: { model: "no-auth/other/nested" },
    error: "No configured credentials",
  },
  { overrides: { reasoning: "extreme" }, error: "Invalid handoff reasoning" },
  { overrides: { reasoning: "xhigh" }, error: "does not support reasoning" },
  {
    overrides: { model: "fixture/no-reasoning" },
    error: "does not support reasoning low",
  },
])(
  "rejects invalid selection before replacement: $overrides",
  async ({ overrides, error }) => {
    const f = await handoffRuntimeFixture({ overrides });
    const original = f.runtime.session;
    await original.prompt("Start a new context with the requested selection.");
    expect(f.runtime.session).toBe(original);
    const results = toolResults(original.sessionManager);
    expect(results).toMatchObject([
      { message: { toolName: "handoff", isError: true } },
    ]);
    expect(JSON.stringify(results)).toContain(error);
    expect(customEntries(original.sessionManager, "handoff-tool")).toEqual([]);
  },
);

test("permits a non-reasoning model with an explicit off override", async () => {
  const f = await handoffRuntimeFixture({
    overrides: { model: "fixture/no-reasoning", reasoning: "off" },
  });
  await f.runtime.session.prompt(
    "Start a new context using the requested model and reasoning off.",
  );
  await f.finished;
  expect(f.runtime.session.model?.id).toBe("no-reasoning");
  expect(f.runtime.session.thinkingLevel).toBe("off");
  expect(f.selections).toHaveLength(2);
});

test.each([
  { replacementModel: "missing", error: "model unavailable" },
  { replacementModel: "unauthenticated", error: "model unavailable" },
] as const)(
  "retains both recovery records without sending if replacement selection is $replacementModel",
  async ({ replacementModel, error }) => {
    const f = await handoffRuntimeFixture({
      overrides: { model: "fixture/other/nested", reasoning: "high" },
      replacementModel,
    });
    const original = f.runtime.session;
    const sourceFile = required(original.sessionFile);
    const failed = f.finished.catch((failure: unknown) => failure);
    await original.prompt("Start a new context using the requested selection.");
    const failure = await failed;
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain(error);
    expect(f.runtime.session.sessionId).not.toBe(original.sessionId);
    expect(f.selections).toHaveLength(1);
    const recovery = customEntries(
      f.runtime.session.sessionManager,
      "handoff-tool",
    );
    expect(recovery).toMatchObject([
      {
        data: {
          prompt: handoffPrompt,
          selection: {
            provider: "fixture",
            modelId: "other/nested",
            reasoning: "high",
          },
        },
      },
    ]);
    const sourceRecovery = customEntries(
      SessionManager.open(sourceFile),
      "handoff-tool",
    );
    expect(sourceRecovery).toMatchObject([
      { data: { prompt: handoffPrompt, status: "requested" } },
    ]);
    expect(
      f.runtime.session.messages.filter((message) => message.role === "user"),
    ).toEqual([]);
  },
);

test("refuses delivery when a later startup handler changes the effective selection", async () => {
  const f = await handoffRuntimeFixture({ changeSelectionAfterSetup: true });
  const failed = f.finished.catch((failure: unknown) => failure);
  await f.runtime.session.prompt("Start a new context.");
  expect(String(await failed)).toContain("effective selection differs");
  expect(f.selections).toHaveLength(1);
  expect(f.runtime.session.thinkingLevel).toBe("high");
});

test("never reapplies persisted selection on reload, resume, fork, or duplicate new dispatch", async () => {
  const f = await handoffRuntimeFixture({
    overrides: { model: "fixture/other/nested", reasoning: "high" },
  });
  const originalFile = required(f.runtime.session.sessionFile);
  await f.runtime.session.prompt(
    "Start a new context with the requested selection.",
  );
  await f.finished;
  const replacementFile = required(f.runtime.session.sessionFile);
  f.runtime.session.setThinkingLevel("minimal");
  await f.runtime.session.extensionRunner.emit({
    type: "session_start",
    reason: "reload",
  });
  await f.runtime.session.extensionRunner.emit({
    type: "session_start",
    reason: "new",
  });
  expect(f.runtime.session.thinkingLevel).toBe("minimal");
  await f.runtime.switchSession(originalFile);
  await f.runtime.switchSession(replacementFile);
  expect(f.runtime.session.thinkingLevel).toBe("minimal");
  const leaf = required(f.runtime.session.sessionManager.getLeafId());
  await f.runtime.fork(leaf, { position: "at" });
  expect(f.runtime.session.thinkingLevel).toBe("minimal");
  expect(f.selections).toHaveLength(2);
});
