import type { Block } from "../api/generated/Block";

export const lineHeight = 20;

export type Side = "left" | "right";

type Anchor = [number, number];

export function lineCount(text: string): number {
  if (text === "") return 0;
  const newlines = text.split("\n").length - 1;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

export type Span = Pick<Block, "leftStart" | "leftEnd" | "rightStart" | "rightEnd">;

export function anchors(blocks: Span[], leftLines: number, rightLines: number): Anchor[] {
  const points: Anchor[] = [[0, 0]];
  for (const block of blocks) {
    points.push([block.leftStart, block.rightStart], [block.leftEnd, block.rightEnd]);
  }
  points.push([leftLines, rightLines]);
  return points;
}

export function mapLine(line: number, points: Anchor[], from: Side): number {
  const source: 0 | 1 = from === "left" ? 0 : 1;
  const target: 0 | 1 = source === 0 ? 1 : 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i] as Anchor;
    const b = points[i + 1] as Anchor;
    if (line < a[source] || line > b[source] || b[source] === a[source]) continue;
    const ratio = (line - a[source]) / (b[source] - a[source]);
    return a[target] + ratio * (b[target] - a[target]);
  }
  const last = points[points.length - 1] as Anchor;
  return last[target] + (line - last[source]);
}

export function connector(y1: number, y2: number, z1: number, z2: number, width = 24): string {
  const mid = width / 2;
  return `M0 ${y1} C${mid} ${y1} ${mid} ${z1} ${width} ${z1} L${width} ${z2} C${mid} ${z2} ${mid} ${y2} 0 ${y2} Z`;
}

export type LineState = { kind: Block["kind"]; words: boolean } | null;

export function lineStates(blocks: Block[], side: Side, lines: number): LineState[] {
  const states: LineState[] = new Array(lines).fill(null);
  for (const block of blocks) {
    const start = side === "left" ? block.leftStart : block.rightStart;
    const end = side === "left" ? block.leftEnd : block.rightEnd;
    for (let line = start; line < end && line < lines; line += 1) {
      states[line] = { kind: block.kind, words: block.hasWords };
    }
  }
  return states;
}

export function shortPath(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 5) return path;
  return [parts[0], "…", ...parts.slice(-3)].join("/");
}

export type Range = [number, number];

export type Fold = { left: Range; right: Range };

export const foldContext = 1;
export const foldMinimum = 12;

export function folds(blocks: Block[], leftLines: number, rightLines: number): Fold[] {
  if (blocks.length === 0) return [];
  const runs: [number, number, number, number][] = [];
  let left = 0;
  let right = 0;
  for (const block of blocks) {
    runs.push([left, block.leftStart, right, block.rightStart]);
    left = block.leftEnd;
    right = block.rightEnd;
  }
  runs.push([left, leftLines, right, rightLines]);
  const found: Fold[] = [];
  for (const [index, [ls, le, rs, re]] of runs.entries()) {
    const before = index === 0 ? 0 : foldContext;
    const after = 0;
    if (le - ls !== re - rs) continue;
    const hidden = le - ls - before - after;
    if (hidden < foldMinimum) continue;
    found.push({
      left: [ls + before, ls + before + hidden],
      right: [rs + before, rs + before + hidden],
    });
  }
  return found;
}

export type Layout = {
  rows: number;
  rowOfLine: Int32Array;
  lineOfRow: Int32Array;
};

export function layout(lines: number, hidden: Range[]): Layout {
  const rowOfLine = new Int32Array(lines);
  const lineOfRow: number[] = [];
  let next = 0;
  let row = 0;
  for (const [index, [from, to]] of hidden.entries()) {
    for (; next < from && next < lines; next += 1) {
      rowOfLine[next] = row;
      lineOfRow.push(next);
      row += 1;
    }
    for (; next < to && next < lines; next += 1) rowOfLine[next] = row;
    lineOfRow.push(-(index + 1));
    row += 1;
  }
  for (; next < lines; next += 1) {
    rowOfLine[next] = row;
    lineOfRow.push(next);
    row += 1;
  }
  return { rows: row, rowOfLine, lineOfRow: Int32Array.from(lineOfRow) };
}

export function rowTop(map: Layout, line: number): number {
  if (line >= map.rowOfLine.length) return map.rows;
  return map.rowOfLine[line] ?? map.rows;
}

export function lineAtRow(map: Layout, row: number, hidden: Range[]): number {
  const whole = Math.floor(row);
  if (whole >= map.lineOfRow.length) return map.rowOfLine.length + (row - map.rows);
  const line = map.lineOfRow[Math.max(0, whole)] ?? 0;
  if (line >= 0) return line + (row - whole);
  const fold = hidden[-line - 1];
  return fold ? fold[0] + (row - whole) * (fold[1] - fold[0]) : 0;
}

export const markHeight = 3;

export type Mark = { kind: Block["kind"]; row: number };

export type MarkRun = { kind: Block["kind"]; from: number; to: number };

export function stripeRuns(marks: Mark[], rows: number, height: number): MarkRun[] {
  if (height <= 0) return [];
  const reach = (markHeight * Math.max(rows, 1)) / height;
  const open = new Map<Block["kind"], MarkRun>();
  const runs: MarkRun[] = [];
  for (const { kind, row } of marks) {
    const run = open.get(kind);
    if (run && row - run.to <= reach) {
      run.to = row;
    } else {
      const next = { kind, from: row, to: row };
      runs.push(next);
      open.set(kind, next);
    }
  }
  return runs;
}
