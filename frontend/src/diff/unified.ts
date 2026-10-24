import type { Block } from "../api/generated/Block";
import type { FileDiff } from "../api/generated/FileDiff";
import { lineCount } from "./geometry";

export type UnifiedRow = {
  old: number | null;
  new: number | null;
  kind: "context" | "deleted" | "inserted";
  words: boolean;
};

export type UnifiedMark = { from: number; to: number; className: string };

export type Unified = {
  text: string;
  rows: UnifiedRow[];
  marks: UnifiedMark[];
  blocks: { start: number; end: number; kind: Block["kind"] }[];
};

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return text === "" ? [] : lines;
}

function lineStarts(lines: string[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function buildUnified(diff: FileDiff): Unified {
  const left = splitLines(diff.left.text);
  const right = splitLines(diff.right.text);
  const leftStarts = lineStarts(left);
  const rightStarts = lineStarts(right);
  const lines: string[] = [];
  const rows: UnifiedRow[] = [];
  const blocks: Unified["blocks"] = [];
  const placed: { side: "left" | "right"; line: number; row: number }[] = [];
  let l = 0;
  let r = 0;
  const context = (untilLeft: number, untilRight: number) => {
    while (l < untilLeft && r < untilRight) {
      lines.push(right[r] ?? "");
      rows.push({ old: l + 1, new: r + 1, kind: "context", words: false });
      l += 1;
      r += 1;
    }
    for (; l < untilLeft; l += 1) {
      lines.push(left[l] ?? "");
      rows.push({ old: l + 1, new: null, kind: "context", words: false });
    }
    for (; r < untilRight; r += 1) {
      lines.push(right[r] ?? "");
      rows.push({ old: null, new: r + 1, kind: "context", words: false });
    }
  };
  for (const block of diff.blocks) {
    context(block.leftStart, block.rightStart);
    const start = rows.length;
    for (let line = block.leftStart; line < block.leftEnd; line += 1) {
      placed.push({ side: "left", line, row: rows.length });
      lines.push(left[line] ?? "");
      rows.push({ old: line + 1, new: null, kind: "deleted", words: block.hasWords });
    }
    for (let line = block.rightStart; line < block.rightEnd; line += 1) {
      placed.push({ side: "right", line, row: rows.length });
      lines.push(right[line] ?? "");
      rows.push({ old: null, new: line + 1, kind: "inserted", words: block.hasWords });
    }
    blocks.push({ start, end: rows.length, kind: block.kind });
    l = block.leftEnd;
    r = block.rightEnd;
  }
  context(lineCount(diff.left.text), lineCount(diff.right.text));

  const unifiedStarts = lineStarts(lines);
  const rowOf = new Map(placed.map((p) => [`${p.side}:${p.line}`, p.row]));
  const marks: UnifiedMark[] = [];
  const mark = (
    side: "left" | "right",
    starts: number[],
    from: number,
    to: number,
    className: string,
  ) => {
    const line = lineOf(starts, from);
    const row = rowOf.get(`${side}:${line}`);
    if (row === undefined) return;
    const base = unifiedStarts[row] ?? 0;
    const lineStart = starts[line] ?? 0;
    const lineEnd = lineStart + ((side === "left" ? left : right)[line] ?? "").length;
    marks.push({
      from: base + (from - lineStart),
      to: base + (Math.min(to, lineEnd) - lineStart),
      className,
    });
    if (to > lineEnd + 1) mark(side, starts, lineEnd + 1, to, className);
  };
  for (const block of diff.blocks) {
    for (const word of block.leftWords) mark("left", leftStarts, word.start, word.end, "dl-w-del");
    for (const word of block.rightWords)
      mark("right", rightStarts, word.start, word.end, "dl-w-ins");
  }
  return {
    text: lines.length > 0 ? `${lines.join("\n")}\n` : "",
    rows,
    marks: marks.filter((m) => m.to > m.from),
    blocks,
  };
}
