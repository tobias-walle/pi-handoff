# pi-handoff

Start a fresh session with the context you need for [pi](https://pi.dev).

Generate an editable handoff draft, or ask the agent to finish a task and continue in a new context.

## Features

- Review and edit a generated starting prompt before submitting it.
- Let the agent transfer a self-contained prompt after you explicitly request a new context.
- Keep the current model and reasoning level, or explicitly request different ones.
- Recover a model-requested handoff prompt if session replacement or submission fails.

## Requirements

- Node.js 24 or newer.
- `@earendil-works/pi-coding-agent` with session replacement support, tested with 1.3.0. Other pi distributions may not provide the required APIs.
- A configured model and its credentials in pi.

## Install

```sh
pi install git:github.com/tobias-walle/pi-handoff
```

Restart pi or run `/reload`. Remove any older local handoff extensions to avoid duplicate commands and tools.

## Usage

### Generate a draft

```text
/handoff Continue by testing the error cases in src/example.ts
```

`/handoff [instructions]` sends the active conversation branch and your optional instructions to the selected model. It opens a linked new session with the generated prompt in the editor, without submitting it. Edit the draft, then press Enter to submit. Press Escape while generating to cancel.

This command requires the interactive terminal UI. Draft requests time out after two minutes. There are no command flags, global shortcuts, or extension-specific config files.

### Ask for an automatic handoff

```text
Finish the tests, then start a new context to review the changes.
```

The model-facing `handoff` tool starts a new session and submits the supplied prompt without a draft review. Its instructions require explicit user authorization and a call without sibling tools. Authorization is a model instruction, not a separate approval dialog.

Tool fields:

- `prompt`: required, non-empty, self-contained instructions for the next session. Slash-command text is submitted literally, not expanded.
- `title`: optional searchable session title. Whitespace is normalized and the title is limited to 120 characters. If omitted or blank, pi can generate a title.
- `model`: optional exact `provider/model-id`. Omitted, empty, or whitespace-only values inherit the current model. The model must exist and have configured credentials.
- `reasoning`: optional `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Omitted, empty, or whitespace-only values inherit the current level independently of `model`. Unsupported combinations fail before switching, without silently lowering the requested level.

The tool supports interactive and RPC sessions, not print or JSON mode. Queued messages, new input, branch changes, interrupted runs, or shutdown cancel pending work.

`/handoff-run <request-id>` is an internal command used by the tool. It accepts only the active in-memory request ID and cannot replay saved handoffs. Do not invoke it manually.

### Privacy and recovery

Manual drafts send conversation history to your selected model provider. Automatic handoffs send their supplied prompt to the next session's model. The extension adds no telemetry and contacts no separate service.

Automatic handoff prompts, model selections, and source-session references are stored in pi session files and tool results for recovery. The new session receives the supplied prompt, not the old conversation. Review prompts before sharing session files.

## Troubleshooting

**The extension does not load**

Check that you use the supported pi distribution and remove duplicate local handoff extensions. Restart pi after installation.

**No draft is created**

Run the command in the terminal UI after starting a conversation. Check model credentials. Empty responses, provider failures, and timeouts leave the current session unchanged.

**A model or reasoning override is rejected**

Use an exact provider/model ID and a reasoning level supported by that model. If the model does not support reasoning, request `off` explicitly.

**An automatic handoff fails**

The prompt remains in the source tool result. If a new session already opened, its custom session entries also contain the prompt. Copy it into the editor and submit after correcting the model or credentials. Saved requests are never replayed automatically.

## Update or remove

```sh
pi update git:github.com/tobias-walle/pi-handoff
pi remove git:github.com/tobias-walle/pi-handoff
```

## Development

```sh
npm ci
npm run check
npm run dev
```

`check` runs non-mutating format, lint, type, and isolated offline tests. Use a positional filter such as `npm run check -- test`, `--force` to bypass its cache, and `--verbose` to show command output. Use `npm run fix` and `npm run format` to apply fixes.
