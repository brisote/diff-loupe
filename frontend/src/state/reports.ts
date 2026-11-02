import type { ApiError, ReportEnv } from "../api";
import { isWindowsPath } from "../lib/paths";

export const issueForm =
  "https://github.com/brisote/diff-loupe/issues/new?template=error_report.yml";
export const historySize = 20;
export const failureLimit = 10;

const handled = new Set([
  "notARepository",
  "bareRepository",
  "notFound",
  "targetNotFound",
  "notOpen",
  "noRepository",
  "cancelled",
  "gitRefused",
  "update",
  "storeVersion",
]);

const quiet = new Set(["terminal_write", "terminal_ack", "terminal_resize", "report_env"]);

export type Call = { at: number; command: string; result: string; ms: number };
export type Failure = {
  at: number;
  command: string;
  code: string;
  message: string;
  detail: string | null;
  count: number;
};
export type Context = {
  screen: string;
  build: string;
  state?: string | null;
  repo?: string | null;
};

export function unhandled(error: ApiError): boolean {
  return !handled.has(error.code);
}

export function recorded(command: string): boolean {
  return !quiet.has(command);
}

export function remember(calls: Call[], call: Call): Call[] {
  return [call, ...calls].slice(0, historySize);
}

export function keyOf(failure: Pick<Failure, "command" | "code" | "message">): string {
  return `${failure.command}\n${failure.code}\n${failure.message}`;
}

export function addFailure(failures: Failure[], failure: Failure): Failure[] {
  const key = keyOf(failure);
  const known = failures.find((other) => keyOf(other) === key);
  if (known)
    return failures.map((other) =>
      other === known ? { ...other, count: other.count + 1 } : other,
    );
  return [...failures, failure].slice(-failureLimit);
}

function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const verbatimPrefix = /(?:\\\\\?\\)/;

function pathPattern(path: string): { source: string; flags: string; after: string } {
  const plain = path.replace(/^\\\\\?\\/, "");
  if (!isWindowsPath(plain)) {
    return { source: literal(path.replace(/\/+$/, "")), flags: "g", after: "/" };
  }
  const parts = plain.replace(/[\\/]+$/, "").split(/[\\/]+/);
  return {
    source: `${verbatimPrefix.source}?${parts.map(literal).join("[\\\\/]+")}`,
    flags: "gi",
    after: "\\\\/",
  };
}

export function hidePaths(text: string, home: string | null, repositories: string[]): string {
  const swaps: [string, string][] = [
    ...repositories.filter(Boolean).map((path): [string, string] => [path, "<repository>"]),
    ...(home ? [[home, "~"] as [string, string]] : []),
  ].sort((a, b) => b[0].length - a[0].length);
  let hidden = text;
  for (const [path, mark] of swaps) {
    const { source, flags, after } = pathPattern(path);
    if (source && source !== "(?:)")
      hidden = hidden.replace(new RegExp(`${source}(?=[${after}]|\\s|["'\`:,;)]|$)`, flags), mark);
  }
  return hidden;
}

export function cleanMessage(code: string, message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return code === "invalidArgs" ? flat.replace(/"[^"]*"/g, '"…"').replace(/`[^`]*`/g, "`…`") : flat;
}

const noisyFrame = /(?:node_modules\/(?:\.vite\/deps\/)?react(?:-dom)?|@\[native code\])/;

export function cleanStack(stack: string, limit = 15): string {
  const lines = stack.split("\n");
  const filtered = lines.filter((line) => !noisyFrame.test(line));
  const chosen = filtered.length > 0 ? filtered : lines;
  return chosen.slice(0, limit).join("\n");
}

const noisyComponent =
  /^\s*(?:[a-z0-9-]+@(unknown:0:0|native)|at [a-z0-9-]+(?:\s*\(unknown|\s*$|\s*\(native))/;

export function cleanComponentStack(componentStack: string, limit = 10): string {
  const lines = componentStack.trim().split("\n");
  const filtered = lines.filter((line) => !noisyComponent.test(line));
  const chosen = filtered.length > 0 ? filtered : lines;
  return chosen.slice(0, limit).join("\n");
}

export function stackOf(error: unknown, componentStack?: string | null): string | null {
  const stack = error instanceof Error && error.stack ? cleanStack(error.stack) : "";
  const components = componentStack ? cleanComponentStack(componentStack) : "";
  const detail = [stack, components].filter(Boolean).join("\n");
  return detail || null;
}

function time(at: number): string {
  const date = new Date(at);
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function day(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function reportText(
  env: ReportEnv | null,
  context: Context,
  failures: Failure[],
  calls: Call[],
): string {
  const system = env
    ? `Diffloupe ${env.version} on ${env.os ?? "an unknown system"} (${env.arch}), git ${env.git ?? "unknown"}`
    : "Diffloupe, versions unknown";
  const lines = [
    "### Diffloupe error report",
    "",
    `- ${system}`,
    `- Build: ${context.build}`,
    `- Screen: ${context.screen}`,
  ];
  if (context.state) lines.push(`- State: ${context.state}`);
  if (context.repo) lines.push(`- Repo: ${context.repo}`);
  for (const failure of failures) {
    const times = failure.count > 1 ? ` (${failure.count} times)` : "";
    lines.push(
      `- Error: \`${failure.code}\` in \`${failure.command}\` at ${time(failure.at)} on ${day(failure.at)}${times}`,
      `- Message: ${failure.message}`,
    );
    if (failure.detail) lines.push("", "```", failure.detail, "```", "");
  }
  lines.push(
    "",
    "Recent commands, newest first:",
    "",
    "| Time | Command | Result | ms |",
    "|---|---|---|---|",
  );
  for (const call of calls)
    lines.push(`| ${time(call.at)} | ${call.command} | ${call.result} | ${Math.round(call.ms)} |`);
  return lines.join("\n");
}
