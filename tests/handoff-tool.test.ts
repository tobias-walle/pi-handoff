import { describe, expect, test, vi } from "vitest";
import {
  handoffAssistant as assistant,
  handoffFixture as fixture,
} from "./support/handoff.ts";

function handoffId(details: unknown): string {
  if (
    typeof details !== "object" ||
    details === null ||
    !("id" in details) ||
    typeof details.id !== "string"
  )
    throw new Error("Missing handoff id");
  return details.id;
}

describe("handoff tool", () => {
  test("waits for idle, links the session, persists recovery data, and submits literal prompt text", async () => {
    const f = await fixture();
    const prompt =
      "/review Keep this literal. Review the changes in src/example.ts.";
    const result = await f.execute(prompt);

    expect(result.terminate).toBe(true);
    expect(f.state.switches).toBe(0);
    expect(result.details).toMatchObject({ prompt });
    await f.finish();
    expect(f.state.switches).toBe(1);
    expect(f.state.parentSession).toBe(f.manager.getSessionFile());
    expect(f.submitted).toEqual([
      { prompt, options: { expandPromptTemplates: false } },
    ]);
    expect(f.replacement.getBranch()).toContainEqual(
      expect.objectContaining({
        type: "custom",
        customType: "handoff-tool",
        data: result.details,
      }),
    );
  });

  test("names the new session before it starts", async () => {
    const f = await fixture();
    const result = await f.execute("Next task", "  Ralph api-v2:\n add tests ");

    expect(result.details).toMatchObject({ title: "Ralph api-v2: add tests" });
    await f.finish();
    expect(f.replacement.getSessionName()).toBe("Ralph api-v2: add tests");
  });

  test("leaves the session unnamed without a title", async () => {
    const f = await fixture();
    const result = await f.execute("Next task", "  ");

    expect(result.details).not.toHaveProperty("title");
    await f.finish();
    expect(f.replacement.getSessionName()).toBeUndefined();
  });

  test("rejects blank prompts and unsupported modes", async () => {
    const f = await fixture();

    await expect(f.execute("  \n")).rejects.toThrow("must not be empty");
    f.state.mode = "print";
    await expect(f.execute()).rejects.toThrow(
      "requires interactive or RPC mode",
    );
    expect(f.dispatches).toHaveLength(0);
  });

  test("rejects queued input, aborted calls, and parallel tool batches", async () => {
    const f = await fixture();

    f.state.queued = true;
    await expect(f.execute()).rejects.toThrow("queued user messages");
    f.state.queued = false;
    f.manager.appendMessage(assistant(["call-1", "call-2"]));
    await expect(f.execute()).rejects.toThrow("alone");
    f.controller.abort();
    await expect(f.execute()).rejects.toThrow("aborted");
    expect(f.dispatches).toHaveLength(0);
  });

  test("rejects duplicate tools and command dispatches", async () => {
    const f = await fixture();
    const result = await f.execute();

    await expect(f.execute()).rejects.toThrow("already pending");

    const details = handoffId(result.details);

    await f.runCommand(details);
    await f.finish();
    expect(f.state.switches).toBe(1);
  });

  test.each(["input", "before_agent_start", "session_before_tree"] as const)(
    "cancels on %s",
    async (event) => {
      const f = await fixture();
      await f.execute();
      await f.emit(event);
      await f.finish();
      expect(f.state.switches).toBe(0);
      expect(f.notifications.join(" ")).toContain("Handoff cancelled");
    },
  );

  test.each(["error", "aborted"] as const)(
    "cancels when the current run is %s",
    async (outcome) => {
      const f = await fixture();
      await f.execute();
      await f.emit(outcome);
      await f.finish();
      expect(f.state.switches).toBe(0);
    },
  );

  test("also checks the abort signal after waiting", async () => {
    const f = await fixture();
    await f.execute();
    f.controller.abort();
    await f.finish();
    expect(f.state.switches).toBe(0);
  });

  test("also checks queued messages after waiting", async () => {
    const f = await fixture();
    await f.execute();
    f.state.queued = true;
    await f.finish();
    expect(f.state.switches).toBe(0);
  });

  test("rejects a changed source session after the idle wait", async () => {
    const f = await fixture();
    await f.execute();
    vi.spyOn(f.manager, "getSessionId").mockReturnValue("different-session");
    await f.finish();
    expect(f.state.switches).toBe(0);
    expect(f.notifications.join(" ")).toContain("The active session changed.");
    expect(f.submitted).toEqual([]);
  });

  test("drops pending work on shutdown without accessing the stale context", async () => {
    const f = await fixture();

    await f.execute();
    await f.emit("session_shutdown");
    f.state.stale = true;
    await f.finish();
    expect(f.state.switches).toBe(0);
  });

  test("ignores unknown internal requests and never replays persisted requests", async () => {
    const f = await fixture();

    f.manager.appendCustomEntry("handoff-tool", {
      id: "old",
      prompt: "Do not replay",
    });
    await f.runCommand("old");
    expect(f.state.switches).toBe(0);
    expect(f.submitted).toHaveLength(0);
  });

  test("does not submit a prompt when session replacement is cancelled", async () => {
    const f = await fixture();

    f.state.cancelled = true;

    await f.execute();
    await f.finish();
    expect(f.submitted).toHaveLength(0);
    expect(f.notifications.join(" ")).toContain("New session cancelled");
  });

  test("reports creation errors through the command and keeps source recovery data", async () => {
    const f = await fixture();

    f.state.createError = true;

    const result = await f.execute();

    await expect(f.finish()).rejects.toThrow("Session creation failed");
    expect(
      f.manager
        .getBranch()
        .findLast(
          (entry: Readonly<{ type: string }>) => entry.type === "custom",
        ),
    ).toMatchObject({
      type: "custom",
      data: {
        id: handoffId(result.details),
        prompt: "Next task",
        status: "requested",
      },
    });
  });

  test("keeps recovery data in the new session if prompt submission fails", async () => {
    const f = await fixture();

    f.state.sendError = true;

    const result = await f.execute();

    await expect(f.finish()).rejects.toThrow("Prompt submission failed");
    expect(f.replacement.getBranch()).toContainEqual(
      expect.objectContaining({
        type: "custom",
        data: result.details,
      }),
    );
  });
});
