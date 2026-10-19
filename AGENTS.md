# pi-handoff

Context transfer extension for the [pi coding agent](https://pi.dev).

## Rules

- Run `npm run check` before you finish. `npm run fix` and `npm run format` are the only commands that write source.
- Keep `src/index.ts` thin: it wires commands, tools and events to modules.
- Command options start with `--`.
- Keep failures inside the extension. Report them, never crash pi.
- Keep tests deterministic: isolated agent dir, no network.
- Add a regression test for every fixed defect.
- Keep the README user-facing. Put internals and design reasons here or in code comments.

## Tool compatibility

TypeScript is pinned to the current 6.x release. TypeScript 7 removes the compiler API required by SonarJS and ts-api-utils. Upgrade when that dependency supports it.

## Design notes

Session replacement invalidates the old runtime. Use only plain captured data after replacement and the fresh context in withSession.

The handoff-tool and handoff-selection custom session entries are retained for recovery and compatibility with transcript readers. Never replay persisted requests.
