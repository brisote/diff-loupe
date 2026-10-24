import type { Root } from "hast";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DiffSide, FileDiff } from "../api";
import { LeftHead, RightHead } from "../diff/FileHead";
import { useApp } from "../state/context";
import { type Block, blocks, parse } from "./blocks";
import { type Marked, markRow } from "./mark";
import { match, type Row } from "./match";
import { type Images, render, sources } from "./render";

export type MarkdownRows = { rows: Row[]; marked: Marked[]; changed: number[] };

export function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(path);
}

const renderLimit = 512 * 1024;
const conflictMarker = /^(<{7}|>{7})( |$)/m;

export function canRender(diff: FileDiff): boolean {
  const sides = [diff.left.text, diff.right.text];
  return sides.every((text) => text.length <= renderLimit && !conflictMarker.test(text));
}

export function startsRun(rows: Row[], index: number): boolean {
  return rows[index - 1]?.kind !== rows[index]?.kind;
}

export function markdownRows(before: string, after: string): MarkdownRows {
  const rows = match(blocks(parse(before)), blocks(parse(after)));
  const marked = rows.map(markRow);
  const changed = rows.flatMap((row, index) => (row.kind === "equal" ? [] : [index]));
  return { rows, marked, changed };
}

type Side = "left" | "right";

function revisionOf(side: DiffSide): string | null | undefined {
  if (side.revision) return side.revision;
  return side.title ? undefined : null;
}

function useImages(
  diff: FileDiff,
  trees: { left: Root[]; right: Root[] },
): Record<Side | "merged", Images> {
  const backend = useApp((state) => state.backend);
  const repo = useApp((state) => state.repo?.path);
  const [loaded, setLoaded] = useState<Record<string, string | null>>({});
  const revisions = { left: revisionOf(diff.left), right: revisionOf(diff.right) };
  const wanted = useMemo(() => {
    const list: { side: Side; source: string; rev: string | null }[] = [];
    for (const side of ["left", "right"] as const) {
      const rev = revisionOf(diff[side]);
      if (rev === undefined) continue;
      for (const source of new Set(trees[side].flatMap(sources))) list.push({ side, source, rev });
    }
    return list;
  }, [diff, trees]);

  useEffect(() => {
    if (!repo) return;
    let live = true;
    for (const { side, source, rev } of wanted) {
      const document = side === "left" ? (diff.oldPath ?? diff.path) : diff.path;
      const key = `${side}:${rev}:${source}`;
      void backend
        .call("read_image", { path: repo, document, source, rev })
        .catch(() => null)
        .then((data) => {
          if (live) setLoaded((all) => ({ ...all, [key]: data ?? null }));
        });
    }
    return () => {
      live = false;
    };
  }, [backend, repo, diff.path, diff.oldPath, wanted]);

  const lookup =
    (side: Side): Images =>
    (source) =>
      revisions[side] === undefined ? null : loaded[`${side}:${revisions[side]}:${source}`];
  const left = lookup("left");
  const right = lookup("right");
  return {
    left,
    right,
    merged: (source) => {
      const fresh = right(source);
      return fresh || left(source) || fresh;
    },
  };
}

function blockClass(row: Row, marked: Marked, side: Side | "merged"): string {
  if (row.kind === "equal") return "";
  if (row.kind === "inserted") return "dl-md-block is-inserted";
  if (row.kind === "deleted") return "dl-md-block is-deleted";
  if (marked.whole && side !== "merged") {
    return side === "left" ? "dl-md-block is-deleted" : "dl-md-block is-inserted";
  }
  return "dl-md-block is-modified";
}

type Props = {
  diff: FileDiff;
  rows: MarkdownRows;
  inline: boolean;
  current: number;
  onCurrent: (index: number) => void;
};

export function MarkdownDiff({ diff, rows, inline, current, onCurrent }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const trees = useMemo(
    () => ({
      left: rows.marked.flatMap((marked) =>
        [marked.left, marked.merged].filter((tree): tree is Root => Boolean(tree)),
      ),
      right: rows.marked.flatMap((marked) =>
        [marked.right, marked.merged].filter((tree): tree is Root => Boolean(tree)),
      ),
    }),
    [rows],
  );
  const images = useImages(diff, trees);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F7" || document.querySelector(".app-modal")) return;
      event.preventDefault();
      const count = rows.changed.length;
      if (count === 0) return;
      onCurrent(event.shiftKey ? Math.max(current - 1, 0) : Math.min(current + 1, count - 1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rows.changed.length, current, onCurrent]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const block = (event: Event) => event.preventDefault();
    element.addEventListener("contextmenu", block);
    element.addEventListener("auxclick", block);
    return () => {
      element.removeEventListener("contextmenu", block);
      element.removeEventListener("auxclick", block);
    };
  }, []);

  const changedRef = useRef(rows.changed);
  changedRef.current = rows.changed;
  useEffect(() => {
    const index = changedRef.current[current];
    if (index === undefined) return;
    const target = scroller.current?.querySelector(`[data-row="${index}"]`);
    target?.scrollIntoView({ block: "center" });
  }, [current]);

  const cell = (
    tree: Root | undefined,
    className: string,
    side: Side | "merged",
    block: Block | undefined,
  ) => {
    if (!tree) return null;
    const tight = block?.list && !block.list.last ? "app-md-tight" : "";
    const classes = [className, tight].filter(Boolean).join(" ");
    return <div className={classes || undefined}>{render(tree, images[side])}</div>;
  };

  return (
    <section
      className={`app-md ${inline ? "is-inline" : ""}`}
      aria-label={inline ? "Rendered inline diff" : "Rendered side-by-side diff"}
    >
      {inline ? (
        <div className="dl-filehead app-md-head">
          <LeftHead diff={diff} />
          <span className="dl-crumb-sep">→</span>
          <RightHead diff={diff} />
        </div>
      ) : (
        <div className="app-md-heads">
          <div className="dl-filehead">
            <LeftHead diff={diff} />
          </div>
          <div className="dl-filehead" />
          <div className="dl-filehead app-md-head-right">
            <RightHead diff={diff} />
          </div>
        </div>
      )}
      <div ref={scroller} className="app-md-scroll">
        {inline ? (
          <div className="app-md-inline">
            {rows.rows.map((row, index) => {
              const marked = rows.marked[index];
              if (!marked) return null;
              const key = `${index}-${row.kind}`;
              if (marked.whole) {
                return (
                  <div key={key} className="dl-md" data-row={index}>
                    {cell(marked.left, "dl-md-block is-deleted", "left", row.left)}
                    {cell(marked.right, "dl-md-block is-inserted", "right", row.right)}
                  </div>
                );
              }
              return (
                <div key={key} className="dl-md" data-row={index}>
                  {cell(
                    marked.merged,
                    blockClass(row, marked, "merged"),
                    "merged",
                    row.right ?? row.left,
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="app-md-grid">
            {rows.rows.map((row, index) => {
              const marked = rows.marked[index];
              if (!marked) return null;
              const key = `${index}-${row.kind}`;
              return (
                <div key={key} className="app-md-row" data-row={index}>
                  <div className="dl-md">
                    {row.kind === "inserted"
                      ? startsRun(rows.rows, index) && <div className="app-md-gap is-inserted" />
                      : cell(marked.left, blockClass(row, marked, "left"), "left", row.left)}
                  </div>
                  <div className={`app-md-strip is-${row.kind}`} aria-hidden="true" />
                  <div className="dl-md">
                    {row.kind === "deleted"
                      ? startsRun(rows.rows, index) && <div className="app-md-gap is-deleted" />
                      : cell(marked.right, blockClass(row, marked, "right"), "right", row.right)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
