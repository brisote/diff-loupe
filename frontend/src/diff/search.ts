import type { Range as Ranged } from "@codemirror/state";
import { Decoration } from "@codemirror/view";

export type PaneMatch = {
  side: "left" | "right" | "unified";
  from: number;
  to: number;
  line: number;
};

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function lineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

export function lineAt(starts: number[], pos: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = starts[mid];
    if (start === undefined) break;
    if (start <= pos) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return high;
}

export function findMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
  side: "left" | "right" | "unified" = "unified",
): PaneMatch[] {
  if (!text || !query) return [];
  const flags = caseSensitive ? "g" : "gi";
  const regex = new RegExp(escapeRegex(query), flags);
  const starts = lineStarts(text);
  const matches: PaneMatch[] = [];
  let m: RegExpExecArray | null = regex.exec(text);
  while (m !== null) {
    if (m[0].length === 0) {
      regex.lastIndex += 1;
      m = regex.exec(text);
      continue;
    }
    const from = m.index;
    const to = from + m[0].length;
    matches.push({ side, from, to, line: lineAt(starts, from) });
    m = regex.exec(text);
  }
  return matches;
}

export function sortSplitMatches(left: PaneMatch[], right: PaneMatch[]): PaneMatch[] {
  const all = [...left, ...right];
  return all.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.side !== b.side) return a.side === "left" ? -1 : 1;
    return a.from - b.from;
  });
}

export function searchDecorations(
  matches: PaneMatch[],
  activeMatch: PaneMatch | null,
): Ranged<Decoration>[] {
  const decorations: Ranged<Decoration>[] = [];
  for (const m of matches) {
    const isCurrent =
      activeMatch !== null &&
      activeMatch.side === m.side &&
      activeMatch.from === m.from &&
      activeMatch.to === m.to;
    const className = isCurrent ? "dl-search-match is-current" : "dl-search-match";
    decorations.push(Decoration.mark({ class: className }).range(m.from, m.to));
  }
  return decorations;
}

export type MarkdownMatch = {
  row: number;
  side: "left" | "right";
};

export function findMarkdownMatches(
  rows: { left?: { text: string }; right?: { text: string } }[],
  query: string,
  caseSensitive: boolean,
): MarkdownMatch[] {
  if (!query) return [];
  const flags = caseSensitive ? "g" : "gi";
  const regex = new RegExp(escapeRegex(query), flags);
  const matches: MarkdownMatch[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    if (row.left?.text) {
      regex.lastIndex = 0;
      let m = regex.exec(row.left.text);
      while (m !== null) {
        if (m[0].length === 0) {
          regex.lastIndex += 1;
          m = regex.exec(row.left.text);
          continue;
        }
        matches.push({ row: i, side: "left" });
        m = regex.exec(row.left.text);
      }
    }
    if (row.right?.text) {
      regex.lastIndex = 0;
      let m = regex.exec(row.right.text);
      while (m !== null) {
        if (m[0].length === 0) {
          regex.lastIndex += 1;
          m = regex.exec(row.right.text);
          continue;
        }
        matches.push({ row: i, side: "right" });
        m = regex.exec(row.right.text);
      }
    }
  }
  return matches;
}
