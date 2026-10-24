import type { Range, Text } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { Block } from "../api/generated/Block";
import type { Side } from "./geometry";

const wordClass = { inserted: "dl-w-ins", deleted: "dl-w-del", modified: "dl-w-mod" } as const;

export function diffDecorations(doc: Text, blocks: Block[], side: Side): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  for (const block of blocks) {
    const start = side === "left" ? block.leftStart : block.rightStart;
    const end = side === "left" ? block.leftEnd : block.rightEnd;
    if (end > start) {
      const lineClass = `cm-diff-${block.kind}${block.hasWords ? " has-words" : ""}`;
      for (let line = start; line < end && line < doc.lines; line += 1) {
        ranges.push(Decoration.line({ class: lineClass }).range(doc.line(line + 1).from));
      }
    } else if (doc.length > 0 || doc.lines > 0) {
      const above = start > 0 && start <= doc.lines;
      const anchor = above ? doc.line(start).from : 0;
      ranges.push(
        Decoration.line({
          class: `cm-gap-${above ? "after" : "before"} cm-gap-${block.kind}`,
        }).range(anchor),
      );
    }
    const words = side === "left" ? block.leftWords : block.rightWords;
    for (const word of words) {
      if (word.end > word.start && word.end <= doc.length) {
        ranges.push(Decoration.mark({ class: wordClass[word.kind] }).range(word.start, word.end));
      }
    }
  }
  return ranges;
}
