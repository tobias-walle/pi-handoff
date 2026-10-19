# pi-handoff

Adds a `handoff` tool to [pi](https://pi.dev) so your agent can continue work in a fresh session when you ask it to.

## Install

```sh
pi install git:github.com/tobias-walle/pi-handoff
```

Requires Node.js 24+ and `@earendil-works/pi-coding-agent` with session replacement support. Tested with 1.3.0.

Restart pi or run `/reload`.

## Usage

Ask your agent:

> Finish the tests, then start a new context to review the changes.

The agent writes a handoff prompt and submits it in a new session. The current model and reasoning level carry over unless you ask for different ones.

The tool accepts:

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
