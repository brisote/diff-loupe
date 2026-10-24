import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import type { MergeChunk } from "../api/generated/MergeChunk";
import type { MergeFile } from "../api/generated/MergeFile";
import {
  acceptSide,
  applyNonConflicting,
  type ChunkState,
  ignoreSide,
  initialStates,
  isResolved,
  mapStates,
  remainingLabel,
  resolveSimple,
  resultLines,
  sliceLines,
  unresolvedText,
} from "./model";

function chunk(
  kind: MergeChunk["kind"],
  base: [number, number],
  ours: [number, number],
  theirs: [number, number],
  combined: string | null = null,
): MergeChunk {
  return {
    kind,
    baseStart: base[0],
    baseEnd: base[1],
    oursStart: ours[0],
    oursEnd: ours[1],
    theirsStart: theirs[0],
    theirsEnd: theirs[1],
    combined,
  };
}

const file: MergeFile = {
  path: "Totals.kt",
  content: "text",
  crlf: false,
  base: "a\nb\nc\nd\ne\n",
  ours: "a\nB1\nc\nd\nours\ne\n",
  theirs: "A\nB2\nc\nd\ne\n",
  chunks: [
    chunk("theirs", [0, 1], [0, 1], [0, 1]),
    chunk("conflict", [1, 2], [1, 2], [1, 2]),
    chunk("ours", [4, 4], [4, 5], [4, 4]),
  ],
};

function run(doc: Text, edit: { changes: ChangeSet; states: ChunkState[] } | null) {
  if (!edit) throw new Error("no edit");
  return { doc: edit.changes.apply(doc), states: edit.states };
}

describe("merge model", () => {
  it("starts from the base with every chunk pending", () => {
    const states = initialStates(file);
    expect(states.map((state) => [state.from, state.to, state.ours, state.theirs])).toEqual([
      [0, 2, "none", "pending"],
      [2, 4, "pending", "pending"],
      [8, 8, "pending", "none"],
    ]);
    expect(remainingLabel(states)).toBe("2 changes · 1 conflict");
    expect(sliceLines(file.ours, 4, 5)).toBe("ours\n");
  });

  it("applies the non-conflicting changes from both sides and keeps positions right", () => {
    const doc = Text.of(file.base.split("\n"));
    const next = run(doc, applyNonConflicting(file, doc, initialStates(file)));
    expect(next.doc.toString()).toBe("A\nb\nc\nd\nours\ne\n");
    expect(remainingLabel(next.states)).toBe("0 changes · 1 conflict");
    const conflict = next.states[1] as ChunkState;
    expect(next.doc.sliceString(conflict.from, conflict.to)).toBe("b\n");
    expect(resultLines(next.doc, next.states[2] as ChunkState)).toEqual([4, 5]);
  });

  it("takes both sides of a conflict, left then right", () => {
    const doc = Text.of(file.base.split("\n"));
    let current = { doc, states: initialStates(file) };
    current = run(current.doc, acceptSide(file, current.doc, current.states, 1, "ours"));
    current = run(current.doc, acceptSide(file, current.doc, current.states, 1, "theirs"));
    expect(current.doc.toString()).toBe("a\nB1\nB2\nc\nd\ne\n");
    expect(isResolved(current.states[1] as ChunkState)).toBe(true);
    expect(acceptSide(file, current.doc, current.states, 1, "ours")).toBeNull();
  });

  it("names what is still open", () => {
    expect(unresolvedText(initialStates(file))).toBe("2 changes and 1 conflict");
    expect(
      unresolvedText(ignoreSide(ignoreSide(initialStates(file), 0, "theirs"), 2, "ours")),
    ).toBe("1 conflict");
  });

  it("ignores a side without touching the result", () => {
    const states = ignoreSide(initialStates(file), 2, "ours");
    expect(states[2]?.ours).toBe("ignored");
    expect(isResolved(states[2] as ChunkState)).toBe(true);
    expect(remainingLabel(states)).toBe("1 change · 1 conflict");
  });

  it("marks a chunk edited when the user types inside it and shifts the rest", () => {
    const doc = Text.of(file.base.split("\n"));
    const typed = ChangeSet.of({ from: 3, insert: "X" }, doc.length);
    const states = mapStates(initialStates(file), typed, true);
    expect(states[1]).toMatchObject({ from: 2, to: 5, edited: true });
    expect(states[2]).toMatchObject({ from: 9, to: 9, edited: false });
    expect(isResolved(states[1] as ChunkState)).toBe(true);
    const after = ChangeSet.of({ from: 4, insert: "next " }, doc.length);
    expect(mapStates(initialStates(file), after, true)[1]).toMatchObject({ edited: false });
    const before = ChangeSet.of({ from: 0, insert: "top\n" }, doc.length);
    expect(mapStates(initialStates(file), before, true)[0]).toMatchObject({
      from: 4,
      edited: true,
    });
  });

  it("resolves simple conflicts with the combined text", () => {
    const simple: MergeFile = {
      ...file,
      chunks: [chunk("conflict", [1, 2], [1, 2], [1, 2], "Bboth\n")],
    };
    const doc = Text.of(simple.base.split("\n"));
    const next = run(doc, resolveSimple(doc, initialStates(simple)));
    expect(next.doc.toString()).toBe("a\nBboth\nc\nd\ne\n");
    expect(remainingLabel(next.states)).toBe("All changes are processed");
    expect(resolveSimple(doc, initialStates(file))).toBeNull();
  });
});
