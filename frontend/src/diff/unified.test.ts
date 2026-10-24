import { describe, expect, it } from "vitest";
import type { FileDiff } from "../api/generated/FileDiff";
import { compareRanges } from "./testing";
import { buildUnified } from "./unified";

const side = (text: string) => ({
  text,
  exists: true,
  crlf: false,
  encoding: "UTF-8",
  revision: null,
  title: null,
});

function diff(left: string, right: string, blocks: FileDiff["blocks"]): FileDiff {
  return {
    path: "a.kt",
    oldPath: null,
    content: "text",
    left: side(left),
    right: side(right),
    blocks,
  };
}

describe("buildUnified", () => {
  it("puts removed lines before added lines and keeps both line numbers", () => {
    const unified = buildUnified(
      diff("a\nold\nc\n", "a\nnew\nextra\nc\n", [
        {
          kind: "modified",
          leftStart: 1,
          leftEnd: 2,
          rightStart: 1,
          rightEnd: 3,
          hasWords: true,
          leftWords: [{ start: 2, end: 5, kind: "modified" }],
          rightWords: [
            { start: 2, end: 5, kind: "modified" },
            { start: 6, end: 11, kind: "inserted" },
          ],
        },
      ]),
    );
    expect(unified.text).toBe("a\nold\nnew\nextra\nc\n");
    expect(unified.rows.map((r) => [r.old, r.new, r.kind])).toEqual([
      [1, 1, "context"],
      [2, null, "deleted"],
      [null, 2, "inserted"],
      [null, 3, "inserted"],
      [3, 4, "context"],
    ]);
    expect(unified.blocks).toEqual([{ start: 1, end: 4, kind: "modified" }]);
    expect(compareRanges(unified.text, unified.marks)).toEqual([
      ["old", "dl-w-del"],
      ["new", "dl-w-ins"],
      ["extra", "dl-w-ins"],
    ]);
  });

  it("handles new files, deleted files and a missing final newline", () => {
    expect(
      buildUnified(
        diff("", "x\ny", [
          {
            kind: "inserted",
            leftStart: 0,
            leftEnd: 0,
            rightStart: 0,
            rightEnd: 2,
            hasWords: false,
            leftWords: [],
            rightWords: [],
          },
        ]),
      ).text,
    ).toBe("x\ny\n");
    const gone = buildUnified(
      diff("x\n", "", [
        {
          kind: "deleted",
          leftStart: 0,
          leftEnd: 1,
          rightStart: 0,
          rightEnd: 0,
          hasWords: false,
          leftWords: [],
          rightWords: [],
        },
      ]),
    );
    expect(gone.rows).toEqual([{ old: 1, new: null, kind: "deleted", words: false }]);
  });

  it("keeps both numbers right when unchanged runs differ in length", () => {
    const unified = buildUnified(
      diff("a\n\nb\nc\n", "a\nb\nC\n", [
        {
          kind: "modified",
          leftStart: 3,
          leftEnd: 4,
          rightStart: 2,
          rightEnd: 3,
          hasWords: false,
          leftWords: [],
          rightWords: [],
        },
      ]),
    );
    expect(unified.rows.map((r) => [r.old, r.new, r.kind])).toEqual([
      [1, 1, "context"],
      [2, 2, "context"],
      [3, null, "context"],
      [4, null, "deleted"],
      [null, 3, "inserted"],
    ]);
    expect(unified.text).toBe("a\nb\nb\nc\nC\n");
  });
});
