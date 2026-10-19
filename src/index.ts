import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerHandoffCommand from "./commands/handoff.ts";
import registerHandoffTool from "./tool.ts";

export default function handoff(pi: ExtensionAPI): void {
  registerHandoffCommand(pi);
  registerHandoffTool(pi);
}
