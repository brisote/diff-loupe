import { describe, expect, it } from "vitest";
import { contextFolds } from "./UnifiedViewer";
import type { UnifiedRow } from "./unified";

const rows = (kinds: UnifiedRow["kind"][]): UnifiedRow[] =>
  kinds.map((kind, index) => ({ old: index + 1, new: index + 1, kind, words: false }));

describe("contextFolds", () => {
  it("folds nothing when every row is context", () => {
    expect(contextFolds(rows(Array(40).fill("context")))).toEqual([]);
  });

  it("folds long context runs around a change", () => {
    const kinds: UnifiedRow["kind"][] = [...Array(20).fill("context"), "inserted"];
    kinds.push(...Array(20).fill("context"));
    expect(contextFolds(rows(kinds))).toEqual([
      [0, 20],
      [22, 41],
    ]);
  });
});
