import type { Message } from "@earendil-works/pi-ai";
import {
  BorderedLoader,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const SYSTEM_PROMPT = `
Write a self-contained starting prompt for a fresh session using the conversation and the user's instructions.
Include the goal, relevant decisions, file paths, completed work, and remaining tasks.
Reference existing plan or research files instead of repeating their contents.
The next session has no access to the current conversation.
Do not assume any slash commands or personal workflows exist.
Output only the starting prompt, with no commentary or follow-up questions.
`;

export type DraftRequest = Readonly<{
  model: NonNullable<ExtensionContext["model"]>;
  conversation: string;
  instructions: string;
}>;

export type DraftResult =
  | { kind: "draft"; prompt: string }
  | { kind: "cancelled" }
  | { kind: "failed"; error: string };

export function generateDraft(
  ctx: ExtensionContext,
  request: DraftRequest,
  shutdownSignal: AbortSignal,
): Promise<DraftResult> {
  return ctx.ui.custom<DraftResult>((tui, theme, keys: unknown, done) => {
    void keys;
    const loader = new BorderedLoader(
      tui,
      theme,
      "Generating handoff prompt...",
    );
    const signal = AbortSignal.any([
      loader.signal,
      shutdownSignal,
      AbortSignal.timeout(120_000),
    ]);
    let finished = false;

    function finish(result: DraftResult): void {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", cancel);
      done(result);
    }

    function cancel(): void {
      finish(
        loader.signal.aborted || shutdownSignal.aborted
          ? { kind: "cancelled" }
          : { kind: "failed", error: "Draft generation timed out." },
      );
    }

    loader.onAbort = () => {
      finish({ kind: "cancelled" });
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    else void deliverDraft(ctx.modelRegistry, request, signal, finish);
    return loader;
  });
}

async function deliverDraft(
  registry: ExtensionContext["modelRegistry"],
  request: DraftRequest,
  signal: AbortSignal,
  done: (result: DraftResult) => void,
): Promise<void> {
  try {
    const response = await registry.complete(
      request.model,
      {
        systemPrompt: SYSTEM_PROMPT,
        messages: [draftMessage(request)],
      },
      { signal },
    );

    if (signal.aborted || response.stopReason === "aborted") {
      done({ kind: "cancelled" });
      return;
    }

    if (response.stopReason === "error")
      throw new Error("The selected model could not generate a draft.");

    const prompt = response.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");

    if (prompt.trim() === "")
      throw new Error("The selected model returned an empty draft.");

    done({ kind: "draft", prompt });
  } catch (error) {
    done(
      signal.aborted
        ? { kind: "cancelled" }
        : {
            kind: "failed",
            error:
              error instanceof Error
                ? error.message
                : "Draft generation failed.",
          },
    );
  }
}

function draftMessage(request: DraftRequest): Message {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: [
          "## Conversation History",
          "",
          request.conversation,
          "",
          "## Special instructions",
          "",
          request.instructions,
          "",
          "Output only the prompt for the next session. Never ask follow-up questions.",
        ].join("\n"),
      },
    ],
    timestamp: Date.now(),
  };
}
