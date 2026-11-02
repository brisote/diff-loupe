import { describe, expect, it } from "vitest";
import {
  escapeRegex,
  findMarkdownMatches,
  findMatches,
  lineAt,
  lineStarts,
  searchDecorations,
  sortSplitMatches,
} from "./search";

describe("escapeRegex", () => {
  it("escapes regex special characters", () => {
    expect(escapeRegex("foo.bar(baz)[0]?*+$^")).toBe("foo\\.bar\\(baz\\)\\[0\\]\\?\\*\\+\\$\\^");
  });
});

describe("lineStarts and lineAt", () => {
  it("computes line start offsets and locates positions", () => {
    const text = "abc\ndefgh\nijk";
    const starts = lineStarts(text);
    expect(starts).toEqual([0, 4, 10]);
    expect(lineAt(starts, 0)).toBe(0);
    expect(lineAt(starts, 2)).toBe(0);
    expect(lineAt(starts, 4)).toBe(1);
    expect(lineAt(starts, 8)).toBe(1);
    expect(lineAt(starts, 10)).toBe(2);
  });
});

describe("findMatches", () => {
  it("returns empty array when text or query is empty", () => {
    expect(findMatches("", "foo", false)).toEqual([]);
    expect(findMatches("hello world", "", false)).toEqual([]);
  });

  it("finds case-insensitive matches by default", () => {
    const text = "Invoice invoice INVOICE other";
    const matches = findMatches(text, "invoice", false, "left");
    expect(matches).toHaveLength(3);
    expect(matches[0]).toEqual({ side: "left", from: 0, to: 7, line: 0 });
    expect(matches[1]).toEqual({ side: "left", from: 8, to: 15, line: 0 });
    expect(matches[2]).toEqual({ side: "left", from: 16, to: 23, line: 0 });
  });

  it("finds case-sensitive matches when requested", () => {
    const text = "Invoice invoice INVOICE other";
    const matches = findMatches(text, "Invoice", true, "right");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({ side: "right", from: 0, to: 7, line: 0 });
  });
});

describe("sortSplitMatches", () => {
  it("sorts left and right matches in reading order", () => {
    const left = [
      { side: "left" as const, from: 20, to: 23, line: 2 },
      { side: "left" as const, from: 0, to: 3, line: 0 },
    ];
    const right = [
      { side: "right" as const, from: 0, to: 3, line: 0 },
      { side: "right" as const, from: 10, to: 13, line: 1 },
    ];
    const sorted = sortSplitMatches(left, right);
    expect(sorted.map((m) => `${m.line}:${m.side}`)).toEqual([
      "0:left",
      "0:right",
      "1:right",
      "2:left",
    ]);
  });
});

describe("searchDecorations", () => {
  it("applies dl-search-match and is-current to active match", () => {
    const matches = [
      { side: "left" as const, from: 0, to: 3, line: 0 },
      { side: "left" as const, from: 10, to: 13, line: 1 },
    ];
    const targetMatch = matches[1];
    expect(targetMatch).toBeDefined();
    if (!targetMatch) return;
    const decorations = searchDecorations(matches, targetMatch);
    expect(decorations).toHaveLength(2);
    const firstSpec = decorations[0]?.value.spec as { class?: string } | undefined;
    expect(firstSpec?.class).toBe("dl-search-match");
    const secondSpec = decorations[1]?.value.spec as { class?: string } | undefined;
    expect(secondSpec?.class).toBe("dl-search-match is-current");
  });
});

describe("findMarkdownMatches", () => {
  it("returns empty array when query is empty", () => {
    const rows = [{ left: { text: "hello" }, right: { text: "world" } }];
    expect(findMarkdownMatches(rows, "", false)).toEqual([]);
  });

  it("finds matches in left and right blocks", () => {
    const rows = [
      { left: { text: "First heading" }, right: { text: "First paragraph" } },
      { left: { text: "Second line" }, right: { text: "Third line with First" } },
    ];
    const matches = findMarkdownMatches(rows, "first", false);
    expect(matches).toEqual([
      { row: 0, side: "left" },
      { row: 0, side: "right" },
      { row: 1, side: "right" },
    ]);
  });

  it("respects case sensitivity in markdown blocks", () => {
    const rows = [{ left: { text: "Alpha beta" }, right: { text: "alpha gamma" } }];
    const sensitive = findMarkdownMatches(rows, "Alpha", true);
    expect(sensitive).toEqual([{ row: 0, side: "left" }]);
  });
});
