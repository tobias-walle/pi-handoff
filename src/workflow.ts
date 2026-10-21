/** Model-requested context handoff. */
import { randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type HandoffSelection,
  type SelectionOverrides,
  resolveSelection,
  selectionSetup,
  verifySelection,
} from "./selection.ts";

export const COMMAND = "handoff-run";
const ENTRY_TYPE = "handoff-tool";
const MAX_TITLE_CHARS = 120;

type HandoffAPI = Readonly<
  Pick<ExtensionAPI, "appendEntry" | "sendUserMessage" | "getThinkingLevel">
>;

export type HandoffDetails = Readonly<{
  id: string;
  prompt: string;
  title?: string;
  sourceSessionId: string;
  sourceLeafId: string | null;
  selection: HandoffSelection;
}>;

type PendingHandoff = {
  details: HandoffDetails;
  parentSession: string | undefined;
  signal: Readonly<Pick<AbortSignal, "aborted">> | undefined;
  cancelReason?: string;
  running: boolean;
};

type AssistantEntry = Readonly<{
  type: string;
  message?: Readonly<{
    role: string;
    content?: string | readonly Readonly<{ type: string; id?: string }>[];
  }>;
}>;

function assertSoleToolCall(
  branch: readonly AssistantEntry[],
  toolCallId: string,
): void {
  const latest = branch.findLast(
    (entry) => entry.type === "message" && entry.message?.role === "assistant",
  );
  if (
    latest?.message?.role !== "assistant" ||
    latest.message.content === undefined ||
    typeof latest.message.content === "string"
  )
    throw new Error("handoff must be called directly by the model.");
  const calls = latest.message.content.filter(
    (part) => part.type === "toolCall",
  );
  if (calls.length !== 1 || calls[0]?.id !== toolCallId)
    throw new Error("Call handoff alone, not alongside other tools.");
}

function normalizeTitle(title: string | undefined): string | undefined {
  const normalized = title?.replaceAll(/\s+/gu, " ").trim();
  return normalized === undefined || normalized === ""
    ? undefined
    : normalized.slice(0, MAX_TITLE_CHARS);
}

function cancellationReason(
  request: Readonly<PendingHandoff>,
  ctx: ExtensionContext,
): string | undefined {
  if (request.cancelReason !== undefined) return request.cancelReason;
  if (request.signal?.aborted === true) return "The current run was aborted.";
  if (ctx.hasPendingMessages()) return "User messages are queued.";
  if (ctx.sessionManager.getSessionId() !== request.details.sourceSessionId)
    return "The active session changed.";
  return undefined;
}

function handoffParent(ctx: ExtensionContext): string | undefined {
  // Only incoming setup entries identify a continuation. Outgoing requests and
  // cancellations also use ENTRY_TYPE, but must not change an origin's parent.
  const continuation = ctx.sessionManager
    .getEntries()
    .some(
      (entry) =>
        entry.type === "custom" &&
        entry.customType === ENTRY_TYPE &&
        typeof entry.data === "object" &&
        entry.data !== null &&
        "sourceSessionId" in entry.data &&
        !("status" in entry.data),
    );
  return continuation
    ? ctx.sessionManager.getHeader()?.parentSession
    : ctx.sessionManager.getSessionFile();
}

/** One runtime owns claiming and cancellation. No persisted request is replayed. */
export class HandoffWorkflow {
  private pending: PendingHandoff | undefined;

  private readonly pi: HandoffAPI;

  constructor(pi: HandoffAPI) {
    this.pi = pi;
  }

  cancel(reason: string): void {
    if (this.pending !== undefined) this.pending.cancelReason ??= reason;
  }

  dispose(): void {
    this.pending = undefined;
  }

  request(
    toolCallId: string,
    prompt: string,
    title: string | undefined,
    overrides: SelectionOverrides,
    signal: Readonly<Pick<AbortSignal, "aborted">> | undefined,
    ctx: ExtensionContext,
  ): HandoffDetails {
    if (ctx.mode !== "tui" && ctx.mode !== "rpc")
      throw new Error(
        "handoff requires interactive or RPC mode with session replacement support.",
      );
    if (prompt.trim() === "")
      throw new Error("The handoff prompt must not be empty.");
    if (signal?.aborted === true)
      throw new Error("The current run was aborted.");
    if (this.pending !== undefined)
      throw new Error("A handoff is already pending.");
    if (ctx.hasPendingMessages())
      throw new Error(
        "Handle queued user messages before requesting a handoff.",
      );
    assertSoleToolCall(ctx.sessionManager.getBranch(), toolCallId);
    const selection = resolveSelection(
      overrides,
      ctx,
      this.pi.getThinkingLevel(),
    );
    const normalizedTitle = normalizeTitle(title);
    const details: HandoffDetails = {
      id: randomUUID(),
      prompt,
      selection,
      ...(normalizedTitle === undefined ? {} : { title: normalizedTitle }),
      sourceSessionId: ctx.sessionManager.getSessionId(),
      sourceLeafId: ctx.sessionManager.getLeafId(),
    };
    this.pending = {
      details,
      parentSession: handoffParent(ctx),
      signal,
      running: false,
    };
    this.pi.appendEntry(ENTRY_TYPE, { ...details, status: "requested" });
    // Expansion dispatches the internal command. execute() must not await it:
    // the command waits for idle so this tool result can persist first.
    this.pi.sendUserMessage(`/${COMMAND} ${details.id}`, {
      deliverAs: "followUp",
      expandPromptTemplates: true,
    });
    return details;
  }

  async run(id: string, ctx: ExtensionCommandContext): Promise<void> {
    const request = this.claim(id, ctx);
    if (request === undefined) return;
    await ctx.waitForIdle();
    // Shutdown invalidates ctx. Check ownership before touching it again.
    if (this.pending !== request) return;
    const reason = cancellationReason(request, ctx);
    this.pending = undefined;
    if (reason !== undefined) {
      this.recordCancellation(request.details.id, reason, ctx);
      return;
    }
    await this.replaceAndSubmit(request, ctx);
  }

  private claim(
    id: string,
    ctx: Pick<ExtensionCommandContext, "ui">,
  ): PendingHandoff | undefined {
    const request = this.pending;
    if (
      request === undefined ||
      request.details.id !== id.trim() ||
      request.running
    ) {
      ctx.ui.notify("No matching pending handoff.", "warning");
      return undefined;
    }
    request.running = true;
    return request;
  }

  private recordCancellation(
    id: string,
    reason: string,
    ctx: Pick<ExtensionCommandContext, "ui">,
  ): void {
    this.pi.appendEntry(ENTRY_TYPE, { id, status: "cancelled", reason });
    ctx.ui.notify(
      `Handoff cancelled: ${reason} The prompt remains in the tool result.`,
      "warning",
    );
  }

  private async replaceAndSubmit(
    request: Readonly<PendingHandoff>,
    ctx: ExtensionCommandContext,
  ): Promise<void> {
    const { details, parentSession } = request;
    const result = await ctx.newSession({
      ...(parentSession === undefined ? {} : { parentSession }),
      // The SDK transfers the live mutable session manager to setup.
      setup: (manager) => {
        // Setup precedes session_start. Persist the name and recovery prompt
        // before any generator or model request can consume the new context.
        if (details.title !== undefined)
          manager.appendSessionInfo(details.title);
        manager.appendCustomEntry(ENTRY_TYPE, details);
        const setup = selectionSetup(
          details.id,
          manager.getSessionId(),
          details.selection,
        );
        manager.appendCustomEntry(setup.type, setup.data);
        return Promise.resolve();
      },
      withSession: async (replacementCtx) => {
        verifySelection(details.id, details.selection, replacementCtx);
        await replacementCtx.sendUserMessage(details.prompt, {
          expandPromptTemplates: false,
        });
      },
    });
    // Success invalidates both old pi and ctx. Only cancellation can use them.
    if (result.cancelled) {
      this.pi.appendEntry(ENTRY_TYPE, { id: details.id, status: "cancelled" });
      ctx.ui.notify(
        "New session cancelled. The prompt remains in the handoff tool result.",
        "warning",
      );
    }
  }
}
