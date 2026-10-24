import { type ChangeDesc, ChangeSet, type Text } from "@codemirror/state";
import type { MergeChunk } from "../api/generated/MergeChunk";
import type { MergeFile } from "../api/generated/MergeFile";

export type MergeSide = "ours" | "theirs";
export type SideMark = "pending" | "applied" | "ignored" | "none";

export type ChunkState = {
  chunk: MergeChunk;
  from: number;
  to: number;
  ours: SideMark;
  theirs: SideMark;
  edited: boolean;
};

export type MergeEdit = { changes: ChangeSet; states: ChunkState[] };

export function lineOffsets(text: string): number[] {
  const offsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") offsets.push(index + 1);
  }
  if (offsets[offsets.length - 1] === text.length && text.length > 0) offsets.pop();
  return offsets;
}

function offsetOf(offsets: number[], text: string, line: number): number {
  return offsets[line] ?? text.length;
}

export function sliceLines(text: string, start: number, end: number): string {
  const offsets = lineOffsets(text);
  return text.slice(offsetOf(offsets, text, start), offsetOf(offsets, text, end));
}

function involves(chunk: MergeChunk, side: MergeSide): boolean {
  if (chunk.kind === "conflict" || chunk.kind === "same") return true;
  return chunk.kind === side;
}

export function initialStates(file: MergeFile): ChunkState[] {
  const offsets = lineOffsets(file.base);
  return file.chunks.map((chunk) => ({
    chunk,
    from: offsetOf(offsets, file.base, chunk.baseStart),
    to: offsetOf(offsets, file.base, chunk.baseEnd),
    ours: involves(chunk, "ours") ? "pending" : "none",
    theirs: involves(chunk, "theirs") ? "pending" : "none",
    edited: false,
  }));
}

export function isResolved(state: ChunkState): boolean {
  return state.edited || (state.ours !== "pending" && state.theirs !== "pending");
}

function touches(changes: ChangeDesc, state: ChunkState): boolean {
  let found = false;
  changes.iterChangedRanges((fromA, toA) => {
    if (state.to > state.from) {
      const inserts = fromA === toA && fromA >= state.from && fromA < state.to;
      found ||= inserts || (fromA < state.to && toA > state.from);
    } else {
      found ||= fromA <= state.from && toA >= state.from;
    }
  });
  return found;
}

export function mapStates(
  states: ChunkState[],
  changes: ChangeDesc,
  edited: boolean,
  skip = -1,
): ChunkState[] {
  return states.map((state, index) => {
    if (index === skip) return state;
    const touched = edited && !isResolved(state) && touches(changes, state);
    const from = changes.mapPos(state.from, 1);
    const to = Math.max(from, changes.mapPos(state.to, -1));
    return { ...state, from, to, edited: state.edited || Boolean(touched) };
  });
}

function sideText(file: MergeFile, chunk: MergeChunk, side: MergeSide): string {
  return side === "ours"
    ? sliceLines(file.ours, chunk.oursStart, chunk.oursEnd)
    : sliceLines(file.theirs, chunk.theirsStart, chunk.theirsEnd);
}

function replace(
  doc: Text,
  states: ChunkState[],
  index: number,
  from: number,
  to: number,
  insert: string,
  next: Partial<ChunkState>,
): MergeEdit {
  const changes = ChangeSet.of({ from, to, insert }, doc.length);
  const mapped = mapStates(states, changes, false, index);
  const state = mapped[index] as ChunkState;
  const start = Math.min(state.from, from);
  mapped[index] = { ...state, from: start, to: changes.mapPos(state.to, 1), ...next };
  return { changes, states: mapped };
}

export function acceptSide(
  file: MergeFile,
  doc: Text,
  states: ChunkState[],
  index: number,
  side: MergeSide,
): MergeEdit | null {
  const state = states[index];
  if (!state || state[side] !== "pending" || state.edited) return null;
  const other: MergeSide = side === "ours" ? "theirs" : "ours";
  const text = sideText(file, state.chunk, side);
  const same = state.chunk.kind === "same";
  const marks = {
    [side]: "applied",
    ...(same ? { [other]: "applied" } : {}),
  } as Partial<ChunkState>;
  if (state[other] === "applied" && !same)
    return replace(doc, states, index, state.to, state.to, text, marks);
  return replace(doc, states, index, state.from, state.to, text, marks);
}

export function ignoreSide(states: ChunkState[], index: number, side: MergeSide): ChunkState[] {
  return states.map((state, at) =>
    at === index && state[side] === "pending" ? { ...state, [side]: "ignored" } : state,
  );
}

function compose(current: MergeEdit | null, edit: MergeEdit): MergeEdit {
  return current ? { changes: current.changes.compose(edit.changes), states: edit.states } : edit;
}

function untouched(state: ChunkState): boolean {
  return state.chunk.kind === "conflict" && state.ours === "pending" && state.theirs === "pending";
}

export function resolveSimple(doc: Text, states: ChunkState[]): MergeEdit | null {
  let current: MergeEdit | null = null;
  let docNow = doc;
  let statesNow = states;
  statesNow.forEach((_, index) => {
    const state = statesNow[index] as ChunkState;
    if (isResolved(state) || !untouched(state) || state.chunk.combined === null) return;
    const edit = replace(docNow, statesNow, index, state.from, state.to, state.chunk.combined, {
      ours: "applied",
      theirs: "applied",
    });
    docNow = edit.changes.apply(docNow);
    statesNow = edit.states;
    current = compose(current, edit);
  });
  return current;
}

export function applyNonConflicting(
  file: MergeFile,
  doc: Text,
  states: ChunkState[],
  only?: MergeSide,
): MergeEdit | null {
  let current: MergeEdit | null = null;
  let docNow = doc;
  let statesNow = states;
  states.forEach((initial, index) => {
    const { kind } = initial.chunk;
    if (kind === "conflict") return;
    const side: MergeSide = kind === "theirs" ? "theirs" : "ours";
    if (only && kind !== "same" && side !== only) return;
    const edit = acceptSide(file, docNow, statesNow, index, side);
    if (!edit) return;
    docNow = edit.changes.apply(docNow);
    statesNow = edit.states;
    current = compose(current, edit);
  });
  return current;
}

export function remaining(states: ChunkState[]): { changes: number; conflicts: number } {
  const open = states.filter((state) => !isResolved(state));
  const conflicts = open.filter((state) => state.chunk.kind === "conflict").length;
  return { changes: open.length - conflicts, conflicts };
}

export function remainingLabel(states: ChunkState[]): string {
  const { changes, conflicts } = remaining(states);
  if (changes === 0 && conflicts === 0) return "All changes are processed";
  return `${count(changes, "change")} · ${count(conflicts, "conflict")}`;
}

export function resultLines(doc: Text, state: ChunkState): [number, number] {
  const start = doc.lineAt(state.from).number - 1;
  if (state.to <= state.from) return [start, start];
  const atEnd = state.to >= doc.length && doc.sliceString(doc.length - 1) !== "\n";
  const end = atEnd ? doc.lines : doc.lineAt(state.to).number - 1;
  return [start, Math.max(start, end)];
}

export function unresolvedText(states: ChunkState[]): string {
  const { changes, conflicts } = remaining(states);
  return [
    changes > 0 ? count(changes, "change") : "",
    conflicts > 0 ? count(conflicts, "conflict") : "",
  ]
    .filter(Boolean)
    .join(" and ");
}

export function count(value: number, noun: string): string {
  return value === 1 ? `1 ${noun}` : `${value} ${noun}s`;
}
