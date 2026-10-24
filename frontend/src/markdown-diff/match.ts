import { diffArrays, diffWords } from "diff";
import type { Block } from "./blocks";

export type RowKind = "equal" | "modified" | "inserted" | "deleted";

export type Row = { kind: RowKind; left?: Block; right?: Block };

const pairing = 0.4;
const reach = 24;

export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  let same = 0;
  for (const part of diffWords(a, b)) {
    if (!part.added && !part.removed) same += part.value.length;
  }
  return (2 * same) / (a.length + b.length);
}

function comparable(a: string, b: string): boolean {
  const [short, long] = a.length < b.length ? [a.length, b.length] : [b.length, a.length];
  return long === 0 || short / long >= pairing / 2;
}

function pair(removed: Block[], added: Block[]): Row[] {
  const [left] = removed;
  const [right] = added;
  if (removed.length === 1 && added.length === 1 && left && right && left.kind === right.kind) {
    return [{ kind: "modified", left, right }];
  }
  const rows: Row[] = [];
  let next = 0;
  for (const left of removed) {
    const found = added.findIndex(
      (right, index) =>
        index >= next &&
        index < next + reach &&
        right.kind === left.kind &&
        comparable(left.text, right.text) &&
        similarity(left.text, right.text) >= pairing,
    );
    if (found < 0) {
      rows.push({ kind: "deleted", left });
      continue;
    }
    for (const right of added.slice(next, found)) rows.push({ kind: "inserted", right });
    rows.push({ kind: "modified", left, right: added[found] });
    next = found + 1;
  }
  for (const right of added.slice(next)) rows.push({ kind: "inserted", right });
  return rows;
}

export function match(left: Block[], right: Block[]): Row[] {
  const changes = diffArrays(
    left.map((block) => block.key),
    right.map((block) => block.key),
  );
  const rows: Row[] = [];
  let l = 0;
  let r = 0;
  let removed: Block[] = [];
  let added: Block[] = [];
  const flush = () => {
    rows.push(...pair(removed, added));
    removed = [];
    added = [];
  };
  for (const change of changes) {
    const count = change.count ?? change.value.length;
    if (change.removed) {
      removed.push(...left.slice(l, l + count));
      l += count;
    } else if (change.added) {
      added.push(...right.slice(r, r + count));
      r += count;
    } else {
      flush();
      for (let i = 0; i < count; i += 1) {
        rows.push({ kind: "equal", left: left[l + i], right: right[r + i] });
      }
      l += count;
      r += count;
    }
  }
  flush();
  return rows;
}
