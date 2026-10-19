# pi-handoff

Adds a `handoff` tool to [pi](https://pi.dev) so your agent can continue work in a fresh session when you ask it to.

## Install

```sh
pi install git:github.com/tobias-walle/pi-handoff
```

Requires Node.js 24+ and `@earendil-works/pi-coding-agent` with session replacement support. Tested with 1.3.0.

Restart pi or run `/reload`.

## Usage

Ask your agent for a handoff. It writes a prompt and submits it in a fresh session, keeping the current model and reasoning level unless you specify otherwise.

### Handoff now

> Handoff to a new context and review the changes in src/api.ts.

### Finish first, then handoff

> Finish the tests, then handoff to a new context to review the changes.

### Carry over a plan

> Handoff to a new context to implement docs/plan.md. Include our decisions and the files we already changed.

### Name the session

> Handoff to a new context for a security review. Name the session "API security review".

### Change the model

> Handoff to a new context using openai/gpt-4.1 with reasoning off. Review the error handling.

Use an exact `provider/model-id` available in your pi setup.

### Change only the reasoning level

> Handoff to a new context with high reasoning. Keep the current model and investigate the failing tests.

### Tool parameters

The `handoff` tool accepts:

- `prompt`: context and instructions for the new session.
- `title`: optional session name.
- `model`: optional `provider/model-id`.
- `reasoning`: optional `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Must be supported by the selected model.

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
