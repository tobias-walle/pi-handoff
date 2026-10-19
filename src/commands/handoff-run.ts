import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { COMMAND, type HandoffWorkflow } from "../workflow.ts";

export function registerHandoffRun(
  pi: Pick<ExtensionAPI, "registerCommand">,
  workflow: HandoffWorkflow,
): void {
  pi.registerCommand(COMMAND, {
    description:
      "Internal command for the handoff tool. Requires a pending request ID.",
    handler: (id, ctx) => workflow.run(id, ctx),
  });
}
