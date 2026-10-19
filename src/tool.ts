import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerHandoffRun } from "./commands/handoff-run.ts";
import { registerSelectionSetup } from "./selection.ts";
import { type HandoffDetails, HandoffWorkflow } from "./workflow.ts";

export default function (
  pi: Readonly<
    Pick<
      ExtensionAPI,
      | "on"
      | "appendEntry"
      | "sendUserMessage"
      | "registerCommand"
      | "registerTool"
      | "getThinkingLevel"
      | "setModel"
      | "setThinkingLevel"
    >
  >,
): void {
  registerSelectionSetup(pi);
  const workflow = new HandoffWorkflow(pi);
  pi.on("input", () => {
    workflow.cancel("New input arrived.");
  });
  pi.on("before_agent_start", () => {
    workflow.cancel("Another run started.");
  });
  pi.on("agent_before_settle", (event: Readonly<{ outcome: string }>) => {
    if (event.outcome !== "completed")
      workflow.cancel(`The current run ${event.outcome}.`);
  });
  pi.on("session_before_tree", () => {
    workflow.cancel("The active branch changed.");
  });
  pi.on("session_shutdown", () => {
    workflow.dispose();
  });
  registerHandoffRun(pi, workflow);
  pi.registerTool({
    name: "handoff",
    label: "Handoff to new context",
    exposure: "model-only",
    executionMode: "sequential",
    description: [
      "Start a fresh context and automatically continue with the supplied prompt.",
      "Use ONLY when the user explicitly requests a new context, session or explicit handoff, including a conditional request such as 'when finished, start a new context for X' or 'do a handoff between each task'.",
      "Never initiate a handoff on your own, including to reduce context usage or organize work.",
      "A request to continue with another task alone does not authorize a new context. If unclear, ask the user.",
      "Include all relevant context, decisions, files, and next tasks in the prompt. The new session does not receive the old conversation automatically.",
      "Set model or reasoning ONLY when the user explicitly requests that specific override. Never choose overrides on your own.",
      "Omitted or empty model and reasoning fields independently inherit the current model and reasoning level. Unsupported combinations are rejected before replacement, not silently clamped.",
      "Call this tool alone, after completing the current task. It ends the current run.",
    ].join(" "),
    parameters: Type.Object({
      model: Type.Optional(
        Type.String({
          description:
            "Explicitly user-requested model in exact provider/model-id syntax. Omitted or empty inherits the current model.",
        }),
      ),
      reasoning: Type.Optional(
        Type.String({
          description:
            "Explicitly user-requested reasoning level: off, minimal, low, medium, high, xhigh, or max. Omitted or empty inherits the current level. Must be supported by the selected model.",
        }),
      ),
      prompt: Type.String({
        minLength: 1,
        description:
          "Self-contained starting prompt for the new context, including the next tasks and all relevant context.",
      }),
      title: Type.Optional(
        Type.String({
          description:
            "Short, searchable title for the new session. Put the most specific words first. If omitted, a title is generated.",
        }),
      ),
    }),
    execute(
      toolCallId,
      { prompt, title, model, reasoning },
      signal: Readonly<Pick<AbortSignal, "aborted">> | undefined,
      onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      void onUpdate;
      return Promise.try((): AgentToolResult<HandoffDetails> => {
        const details = workflow.request(
          toolCallId,
          prompt,
          title,
          { model, reasoning },
          signal,
          ctx,
        );
        return {
          content: [
            {
              type: "text",
              text: "Handoff requested. A fresh context will start after this run settles.",
            },
          ],
          details,
          terminate: true,
        };
      });
    },
  });
}
