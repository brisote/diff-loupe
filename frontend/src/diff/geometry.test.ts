import { describe, expect, it } from "vitest";
import type { Block } from "../api/generated/Block";
import {
  anchors,
  connector,
  folds,
  layout,
  lineAtRow,
  lineCount,
  lineStates,
  mapLine,
  rowTop,
  shortPath,
  stripeRuns,
} from "./geometry";

function block(kind: Block["kind"], ls: number, le: number, rs: number, re: number): Block {
  return {
    kind,
    leftStart: ls,
    leftEnd: le,
    rightStart: rs,
    rightEnd: re,
    hasWords: kind === "modified",
    leftWords: [],
    rightWords: [],
  };
}

const blocks = [block("inserted", 10, 10, 10, 15), block("deleted", 20, 30, 25, 25)];
const points = anchors(blocks, 100, 95);

describe("mapLine", () => {
  it("keeps unchanged runs level and shifts after a block", () => {
    expect(mapLine(5, points, "left")).toBe(5);
    expect(mapLine(15, points, "left")).toBe(20);
    expect(mapLine(20, points, "right")).toBe(15);
  });

  it("spreads a changed block across the other side", () => {
    expect(mapLine(25, points, "left")).toBe(25);
    expect(mapLine(12.5, points, "right")).toBe(10);
    expect(mapLine(40, points, "left")).toBe(35);
  });
});

describe("geometry helpers", () => {
  it("counts lines like an editor without the trailing empty line", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("a\nb\n")).toBe(2);
    expect(lineCount("a\nb")).toBe(2);
  });

  it("draws a connector between both ranges", () => {
    expect(connector(20, 40, 40, 80)).toBe("M0 20 C12 20 12 40 24 40 L24 80 C12 80 12 40 0 40 Z");
  });

  it("marks the lines of each block", () => {
    const states = lineStates([block("modified", 1, 3, 1, 2)], "left", 4);
    expect(states).toEqual([
      null,
      { kind: "modified", words: true },
      { kind: "modified", words: true },
      null,
    ]);
  });

  it("shortens long paths from the middle", () => {
    expect(shortPath("billing/src/main/kotlin/acme/billing/InvoiceExporter.kt")).toBe(
      "billing/…/acme/billing/InvoiceExporter.kt",
    );
    expect(shortPath("src/Main.kt")).toBe("src/Main.kt");
  });
});

describe("folds and layout", () => {
  const block = (ls: number, le: number, rs: number, re: number): Block => ({
    kind: "modified",
    leftStart: ls,
    leftEnd: le,
    rightStart: rs,
    rightEnd: re,
    hasWords: false,
    leftWords: [],
    rightWords: [],
  });

  it("folds nothing when the two sides have no differences", () => {
    expect(folds([], 400, 400)).toEqual([]);
  });

  it("folds runs of 12 or more lines and keeps one line after a change", () => {
    const found = folds(
      [block(30, 31, 30, 32), block(40, 41, 41, 42), block(48, 49, 49, 50)],
      70,
      71,
    );
    expect(found).toEqual([
      { left: [0, 30], right: [0, 30] },
      { left: [50, 70], right: [51, 71] },
    ]);
  });

  it("maps lines to rows around a fold and back", () => {
    const hidden: [number, number][] = [[2, 10]];
    const map = layout(12, hidden);
    expect(map.rows).toBe(5);
    expect(rowTop(map, 1)).toBe(1);
    expect(rowTop(map, 5)).toBe(2);
    expect(rowTop(map, 10)).toBe(3);
    expect(rowTop(map, 12)).toBe(5);
    expect(lineAtRow(map, 3, hidden)).toBe(10);
    expect(lineAtRow(map, 2.5, hidden)).toBe(6);
  });
});

describe("stripeRuns", () => {
  it("joins marks of one kind that touch on the stripe", () => {
    const marks = [
      { kind: "modified" as const, row: 0 },
      { kind: "inserted" as const, row: 2 },
      { kind: "modified" as const, row: 3 },
      { kind: "modified" as const, row: 6 },
      { kind: "modified" as const, row: 40 },
    ];
    expect(stripeRuns(marks, 100, 100)).toEqual([
      { kind: "modified", from: 0, to: 6 },
      { kind: "inserted", from: 2, to: 2 },
      { kind: "modified", from: 40, to: 40 },
    ]);
  });

  it("keeps the number of marks bounded by the stripe height", () => {
    const marks = Array.from({ length: 7000 }, (_, index) => ({
      kind: "modified" as const,
      row: index * 3,
    }));
    expect(stripeRuns(marks, 21000, 800)).toEqual([{ kind: "modified", from: 0, to: 20997 }]);
    expect(stripeRuns(marks, 21000, 0)).toEqual([]);
  });
});
