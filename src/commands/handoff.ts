import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  convertToLlm,
  serializeConversation,
} from "@earendil-works/pi-coding-agent";
import { generateDraft } from "../draft.ts";

export default function registerHandoffCommand(pi: ExtensionAPI): void {
  let active: AbortController | undefined;
  pi.on("session_shutdown", () => {
    active?.abort();
  });
  pi.registerCommand("handoff", {
    description: "Generate a context-transfer draft in a new session's editor",
    handler: async (args, ctx) => {
      active?.abort();
      active = new AbortController();
      await runHandoff(args, ctx, active.signal);
    },
  });
}

async function runHandoff(
  args: string,
  ctx: ExtensionCommandContext,
  signal: AbortSignal,
): Promise<void> {
  if (!supportsDraft(args, ctx)) return;

  if (!ctx.model) {
    ctx.ui.notify("No model selected", "error");
    return;
  }

  const messages = [];

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message") messages.push(entry.message);
  }

  if (messages.length === 0) {
    ctx.ui.notify("No conversation to hand off", "error");
    return;
  }

  const parentSession = ctx.sessionManager.getSessionFile();
  const result = await generateDraft(
    ctx,
    {
      model: ctx.model,
      conversation: serializeConversation(convertToLlm(messages)),
      instructions: args.trim(),
    },
    signal,
  );

  if (signal.aborted) return;

  if (result.kind !== "draft") {
    if (result.kind === "cancelled") ctx.ui.notify("Cancelled", "info");
    else ctx.ui.notify(`Handoff failed: ${result.error}`, "error");
    return;
  }

  await openDraft(ctx, result.prompt, parentSession);
}

function supportsDraft(args: string, ctx: ExtensionCommandContext): boolean {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    ctx.ui.notify("handoff requires interactive terminal mode", "error");
    return false;
  }

  if (args.trim().startsWith("--")) {
    ctx.ui.notify(
      "Usage: /handoff [instructions]. No command options are supported.",
      "error",
    );
    return false;
  }

  return true;
}

async function openDraft(
  ctx: ExtensionCommandContext,
  prompt: string,
  parentSession: string | undefined,
): Promise<void> {
  const replacement = await ctx.newSession({
    ...(parentSession === undefined ? {} : { parentSession }),
    withSession: (fresh) => {
      fresh.ui.setEditorText(prompt);
      fresh.ui.notify("Handoff ready. Submit when ready.", "info");
      return Promise.resolve();
    },
  });

  if (replacement.cancelled) ctx.ui.notify("New session cancelled", "info");
}
