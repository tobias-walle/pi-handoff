import { stripVTControlCharacters } from "node:util";
import type {
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type TUI,
  type Terminal,
  TuiMainScreen,
} from "@earendil-works/pi-tui";
import { onTestFinished, vi } from "vitest";
// The SDK exposes this class only as a type at its public entry point.
import { KeybindingsManager } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { fixtureTheme } from "./theme.ts";

export function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error("Missing test fixture value");
  return value;
}

export function testUI(): Readonly<{
  tui: TUI;
  theme: Theme;
  keys: KeybindingsManager;
  output: readonly string[];
  renders: () => number;
}> {
  const output: string[] = [];
  const terminal: Terminal = {
    columns: 200,
    rows: 30,
    kittyProtocolActive: false,
    start() {},
    stop() {},
    drainInput: () => Promise.resolve(),
    write: (data) => {
      output.push(data);
    },
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
    setProgramStatus() {},
  };
  const tui = new TuiMainScreen(terminal);
  // Rendering is observed synchronously, without starting a host terminal.
  let renders = 0;
  vi.spyOn(tui, "requestRender").mockImplementation(() => {
    renders++;
  });
  onTestFinished(() => {
    tui.stop();
  });
  return {
    tui,
    theme: fixtureTheme,
    keys: new KeybindingsManager(),
    output,
    renders: () => renders,
  };
}

type HostedComponent = Component & { dispose?(): void };

export function overlayHost(): Readonly<{
  custom: ExtensionUIContext["custom"];
  render: (width?: number) => string;
  input: (key: string) => void;
  opened: () => number;
  closed: () => number;
  active: () => boolean;
  renders: () => number;
}> {
  const ui = testUI();
  let component: HostedComponent | undefined;
  let opened = 0;
  let closed = 0;
  onTestFinished(() => {
    component?.dispose?.();
    component = undefined;
  });
  return {
    custom: (factory) =>
      new Promise((resolve, reject) => {
        opened++;
        const owned: { component?: HostedComponent } = {};
        let finished = false;
        const result = factory(ui.tui, ui.theme, ui.keys, (value) => {
          if (finished) return;
          finished = true;
          closed++;
          owned.component?.dispose?.();
          if (component === owned.component) component = undefined;
          resolve(value);
        });
        Promise.resolve(result).then((next: Readonly<HostedComponent>) => {
          owned.component = next;
          if (finished) next.dispose?.();
          else component = next;
          return next;
        }, reject);
      }),
    render: (width = 100) =>
      component === undefined ? "" : frame(component, width),
    input: (key) => {
      required(component).handleInput?.(key);
    },
    opened: () => opened,
    closed: () => closed,
    active: () => component !== undefined,
    renders: ui.renders,
  };
}

export function frame(
  component: Readonly<Pick<Component, "render">>,
  width = 200,
): string {
  return stripVTControlCharacters(component.render(width).join("\n"));
}
