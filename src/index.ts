import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerHandoffTool from "./tool.ts";

export default function handoff(pi: ExtensionAPI): void {
  registerHandoffTool(pi);
}
