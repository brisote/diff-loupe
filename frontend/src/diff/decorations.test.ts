import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import type { Block } from "../api/generated/Block";
import { diffDecorations } from "./decorations";
import { languageKey } from "./syntax";

function decorations(text: string, blocks: Block[], side: "left" | "right") {
  const state = EditorState.create({ doc: text, extensions: [EditorState.lineSeparator.of("\n")] });
  const found: { from: number; to: number; className: string }[] = [];
  for (const range of diffDecorations(state.doc, blocks, side)) {
    found.push({ from: range.from, to: range.to, className: String(range.value.spec.class) });
  }
  return { found, lines: state.doc.lines };
}

const modified: Block = {
  kind: "modified",
  leftStart: 1,
  leftEnd: 2,
  rightStart: 1,
  rightEnd: 2,
  hasWords: true,
  leftWords: [{ start: 6, end: 9, kind: "modified" }],
  rightWords: [
    { start: 6, end: 11, kind: "modified" },
    { start: 12, end: 14, kind: "inserted" },
  ],
};

describe("diffDecorations", () => {
  it("colours changed lines and marks words by kind", () => {
    const { found } = decorations("one\ntwo sum\nthree\n", [modified], "left");
    expect(found).toContainEqual({ from: 4, to: 4, className: "cm-diff-modified has-words" });
    expect(found).toContainEqual({ from: 6, to: 9, className: "dl-w-mod" });
    const right = decorations("one\ntwo count x+\nthree\n", [modified], "right").found;
    expect(right).toContainEqual({ from: 12, to: 14, className: "dl-w-ins" });
  });

  it("marks where an inserted block sits on the empty side", () => {
    const inserted: Block = {
      ...modified,
      kind: "inserted",
      leftStart: 2,
      leftEnd: 2,
      rightStart: 2,
      rightEnd: 4,
      hasWords: false,
      leftWords: [],
      rightWords: [],
    };
    const { found } = decorations("a\nb\nc\n", [inserted], "left");
    expect(found).toEqual([{ from: 2, to: 2, className: "cm-gap-after cm-gap-inserted" }]);
    const atTop = decorations("a\n", [{ ...inserted, leftStart: 0, leftEnd: 0 }], "left").found;
    expect(atTop).toEqual([{ from: 0, to: 0, className: "cm-gap-before cm-gap-inserted" }]);
  });

  it("splits lines on newlines only, like the core", () => {
    expect(decorations("a\rb\nc", [], "left").lines).toBe(2);
  });
});

describe("languageKey", () => {
  it("maps extensions and aliases to loaders", () => {
    expect(languageKey("src/Main.kt")).toBe("kt");
    expect(languageKey("build.gradle.kts")).toBe("kt");
    expect(languageKey("web/App.TSX")).toBe("tsx");
    expect(languageKey("config.yml")).toBe("yaml");
    expect(languageKey("README")).toBeNull();
    expect(languageKey("logo.png")).toBeNull();
  });
});
