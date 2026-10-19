import { expect, test } from "vitest";
import handoff from "../src/index.ts";
import { createExtensionHarness } from "./support/extension-harness.ts";

test("the package registers the handoff tool without the manual command", async () => {
  const app = await createExtensionHarness(handoff);
  const runner = app.session.extensionRunner;

  expect(runner.getToolDefinition("handoff")).toBeDefined();
  expect(runner.getCommand("handoff")).toBeUndefined();
  expect(runner.getCommand("handoff-run")).toBeDefined();
});
