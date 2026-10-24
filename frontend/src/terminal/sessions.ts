import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";

export type Screen = {
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
};

const screens = new Map<string, Screen>();
const early = new Map<string, string[]>();

export type Ack = (bytes: number) => void;
let watching = false;

function watchTheme() {
  if (watching) return;
  watching = true;
  new MutationObserver(() => retheme()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function terminalTheme(): ITheme {
  return {
    background: token("--editor-bg"),
    foreground: token("--editor-text"),
    cursor: token("--editor-text"),
    cursorAccent: token("--editor-bg"),
    selectionBackground: token("--editor-selection"),
    black: token("--text-secondary"),
    brightBlack: token("--text-muted"),
    red: token("--text-error"),
    brightRed: token("--text-error"),
    green: token("--text-success"),
    brightGreen: token("--text-success"),
    yellow: token("--text-warning"),
    brightYellow: token("--text-warning"),
    blue: token("--text-link"),
    brightBlue: token("--text-link"),
    magenta: token("--syntax-field"),
    brightMagenta: token("--syntax-field"),
    cyan: token("--syntax-number"),
    brightCyan: token("--syntax-number"),
    white: token("--text-secondary"),
    brightWhite: token("--editor-text"),
  };
}

export function screenFor(id: string, onData: (data: string) => void, ack: Ack): Screen {
  const existing = screens.get(id);
  if (existing) return existing;
  watchTheme();
  const family = token("--font-mono") || "monospace";
  const term = new Terminal({
    fontFamily: `${family}, monospace`,
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 5000,
    theme: terminalTheme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const host = document.createElement("div");
  host.className = "app-terminal-host";
  host.dataset.session = id;
  term.open(host);
  term.onData(onData);
  const screen = { term, fit, host };
  screens.set(id, screen);
  void document.fonts?.load(`13px ${family}`).then(() => {
    term.options.fontFamily = family;
    fit.fit();
  });
  for (const data of early.get(id) ?? []) term.write(data, () => ack(data.length));
  early.delete(id);
  return screen;
}

let focused = 0;

export function focusOnce(id: string, request: number) {
  if (request <= focused) return;
  focused = request;
  screens.get(id)?.term.focus();
}

export function writeScreen(id: string, data: string, ack: Ack) {
  const screen = screens.get(id);
  if (screen) screen.term.write(data, () => ack(data.length));
  else early.set(id, [...(early.get(id) ?? []), data]);
}

export function clearScreen(id: string) {
  screens.get(id)?.term.clear();
}

export function disposeScreen(id: string) {
  early.delete(id);
  const screen = screens.get(id);
  if (!screen) return;
  screen.term.dispose();
  screen.host.remove();
  screens.delete(id);
}

export function retheme() {
  const theme = terminalTheme();
  for (const screen of screens.values()) screen.term.options.theme = theme;
}

export type Send = (data: string) => Promise<unknown>;

export function inputQueue(send: Send): (data: string) => void {
  let waiting = "";
  let busy = false;
  const flush = async () => {
    busy = true;
    while (waiting) {
      const data = waiting;
      waiting = "";
      await send(data).catch(() => undefined);
    }
    busy = false;
  };
  return (data) => {
    waiting += data;
    if (!busy) void flush();
  };
}
