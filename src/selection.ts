import {
  type Api,
  type Model,
  getSupportedThinkingLevels,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

const SELECTION_ENTRY = "handoff-selection";
const Reasoning = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
  Type.Literal("max"),
]);
const Selection = Type.Object({
  provider: Type.String(),
  modelId: Type.String(),
  reasoning: Reasoning,
});
const Setup = Type.Object({
  id: Type.String(),
  sessionId: Type.String(),
  selection: Selection,
});
const Outcome = Type.Object({
  id: Type.String(),
  status: Type.Union([Type.Literal("applied"), Type.Literal("failed")]),
  error: Type.Optional(Type.String()),
});

export type HandoffSelection = Static<typeof Selection>;

export type SelectionOverrides = {
  model?: string | undefined;
  reasoning?: string | undefined;
};

type SelectionAPI = Pick<
  ExtensionAPI,
  "on" | "appendEntry" | "setModel" | "setThinkingLevel"
>;

/** Capture both independent defaults while the source context is still live. */
export function resolveSelection(
  overrides: SelectionOverrides,
  ctx: ExtensionContext,
  currentReasoning: HandoffSelection["reasoning"],
): HandoffSelection {
  const reference = overrides.model?.trim() ?? "";
  const model =
    reference === "" ? currentModel(ctx) : findModel(reference, ctx);
  if (model === undefined) throw new Error("No current handoff model.");
  if (!ctx.modelRegistry.hasConfiguredAuth(model))
    throw new Error(
      `No configured credentials for ${model.provider}/${model.id}.`,
    );
  return {
    provider: model.provider,
    modelId: model.id,
    reasoning: resolveReasoning(overrides.reasoning, currentReasoning, model),
  };
}

function resolveReasoning(
  reasoning: string | undefined,
  current: HandoffSelection["reasoning"],
  model: Model<Api>,
): HandoffSelection["reasoning"] {
  const override = reasoning?.trim() ?? "";
  const requested = override === "" ? current : override;
  if (!Value.Check(Reasoning, requested))
    throw new Error(`Invalid handoff reasoning level: ${requested}.`);
  if (!getSupportedThinkingLevels(model).includes(requested))
    throw new Error(
      `${model.provider}/${model.id} does not support reasoning ${requested}. Request a supported reasoning level explicitly.`,
    );
  return requested;
}

function currentModel(ctx: ExtensionContext): Model<Api> | undefined {
  if (ctx.model === undefined) return undefined;
  return ctx.modelRegistry.find(ctx.model.provider, ctx.model.id);
}

function findModel(reference: string, ctx: ExtensionContext): Model<Api> {
  const separator = reference.indexOf("/");
  if (separator <= 0 || separator === reference.length - 1)
    throw new Error("Handoff model must use provider/model-id syntax.");
  const model = ctx.modelRegistry.find(
    reference.slice(0, separator),
    reference.slice(separator + 1),
  );
  if (model === undefined)
    throw new Error(`Unknown handoff model: ${reference}.`);
  return model;
}

/** Only the fresh runtime owns these setters. Persisted requests never run on resume/reload. */
export function registerSelectionSetup(pi: SelectionAPI): void {
  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "new") return;
    const entry = ctx.sessionManager
      .getBranch()
      .findLast(
        (candidate) =>
          candidate.type === "custom" &&
          candidate.customType === SELECTION_ENTRY,
      );
    if (entry?.type !== "custom" || !Value.Check(Setup, entry.data)) return;
    const setup = entry.data;
    if (setup.sessionId !== ctx.sessionManager.getSessionId()) return;
    // Consume before awaiting authentication, including duplicate lifecycle dispatches.
    pi.appendEntry(SELECTION_ENTRY, {
      id: setup.id,
      status: "failed",
      error: "Selection setup did not complete.",
    });
    try {
      await applySelection(pi, ctx, setup.selection);
      pi.appendEntry(SELECTION_ENTRY, { id: setup.id, status: "applied" });
    } catch (error) {
      pi.appendEntry(SELECTION_ENTRY, {
        id: setup.id,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

async function applySelection(
  pi: SelectionAPI,
  ctx: ExtensionContext,
  selection: HandoffSelection,
): Promise<void> {
  const model = ctx.modelRegistry.find(selection.provider, selection.modelId);
  if (model === undefined || !(await pi.setModel(model)))
    throw new Error(
      `Handoff model unavailable: ${selection.provider}/${selection.modelId}.`,
    );
  pi.setThinkingLevel(selection.reasoning);
}

export function selectionSetup(
  id: string,
  sessionId: string,
  selection: HandoffSelection,
): { type: string; data: Static<typeof Setup> } {
  return { type: SELECTION_ENTRY, data: { id, sessionId, selection } };
}

/** Refuse literal delivery if startup failed or a later extension changed selection. */
export function verifySelection(
  id: string,
  selection: HandoffSelection,
  ctx: ExtensionContext,
): void {
  verifySetupOutcome(id, ctx);
  if (
    ctx.model?.provider !== selection.provider ||
    ctx.model.id !== selection.modelId ||
    ctx.thinkingLevel !== selection.reasoning
  )
    throw new Error(
      "Handoff effective selection differs from the request. The prompt remains in recovery data.",
    );
}

function verifySetupOutcome(id: string, ctx: ExtensionContext): void {
  const entry = ctx.sessionManager
    .getBranch()
    .findLast(
      (candidate) =>
        candidate.type === "custom" && candidate.customType === SELECTION_ENTRY,
    );
  if (
    entry?.type !== "custom" ||
    !Value.Check(Outcome, entry.data) ||
    entry.data.id !== id
  )
    throw new Error(
      "Handoff selection setup was not acknowledged. The prompt remains in recovery data.",
    );
  if (entry.data.status === "failed")
    throw new Error(
      `Handoff selection failed: ${entry.data.error ?? "unknown error"}. The prompt remains in recovery data.`,
    );
}
