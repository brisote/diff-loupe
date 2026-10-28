import type { Root } from "hast";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DiffSide, FileDiff } from "../api";
import { LeftHead, RightHead } from "../diff/FileHead";
import { foldContext, type Range } from "../diff/geometry";
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

const blockFoldMinimum = 2;

export function markdownFolds(rows: Row[]): Range[] {
  if (rows.every((row) => row.kind === "equal")) return [];
  const found: Range[] = [];
  let start = 0;
  for (let i = 0; i <= rows.length; i += 1) {
    if (i < rows.length && rows[i]?.kind === "equal") continue;
    const before = start === 0 ? 0 : foldContext;
    if (i - start - before >= blockFoldMinimum) found.push([start + before, i]);
    start = i + 1;
  }
  return found;
}

function blockCount(count: number): string {
  return count === 1 ? "1 unchanged block" : `${count} unchanged blocks`;
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
  collapse: boolean;
  current: number;
  onCurrent: (index: number) => void;
};

export function MarkdownDiff({ diff, rows, inline, collapse, current, onCurrent }: Props) {
  const scroller = useRef<HTMLElement>(null);
  const left = useRef<HTMLElement>(null);
  const strips = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [folding, setFolding] = useState(collapse);
  if (folding !== collapse) {
    setFolding(collapse);
    setExpanded(new Set());
  }
  const hidden = useMemo(
    () => (collapse ? markdownFolds(rows.rows).filter(([from]) => !expanded.has(from)) : []),
    [collapse, rows.rows, expanded],
  );
  const foldAt = (index: number): Range | undefined =>
    hidden.find(([from, to]) => index >= from && index < to);
  const fold = (index: number, twin = false) => {
    const range = foldAt(index);
    if (!range) return undefined;
    if (range[0] !== index) return null;
    const label = `Show ${blockCount(range[1] - range[0])}`;
    return (
      <button
        key={`fold-${index}`}
        type="button"
        className="dl-fold app-fold app-md-fold"
        title={label}
        aria-label={label}
        aria-hidden={twin || undefined}
        tabIndex={twin ? -1 : undefined}
        onClick={() => setExpanded((set) => new Set(set).add(range[0]))}
      />
    );
  };
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
    const panes = [scroller.current, left.current].filter((pane) => pane !== null);
    const block = (event: Event) => event.preventDefault();
    for (const pane of panes) {
      pane.addEventListener("contextmenu", block);
      pane.addEventListener("auxclick", block);
    }
    return () => {
      for (const pane of panes) {
        pane.removeEventListener("contextmenu", block);
        pane.removeEventListener("auxclick", block);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (inline) return;
    const columns = [left.current, strips.current, scroller.current];
    const cells = columns.map((column) =>
      Array.from(column?.firstElementChild?.children ?? []).filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      ),
    );
    const align = () => {
      const [before = [], , after = []] = cells;
      for (const cell of cells.flat()) cell.style.minHeight = "";
      const heights = before.map((cell, index) =>
        Math.max(cell.offsetHeight, after[index]?.offsetHeight ?? 0),
      );
      heights.forEach((height, index) => {
        for (const column of cells) {
          const cell = column[index];
          if (cell) cell.style.minHeight = `${height}px`;
        }
      });
    };
    align();
    let frame = 0;
    const resized = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(align);
    });
    for (const column of [left.current, scroller.current]) {
      if (column?.firstElementChild) resized.observe(column.firstElementChild);
    }
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
    };
  });

  const follow = (from: HTMLElement | null) => {
    if (!from) return;
    for (const pane of [left.current, strips.current, scroller.current]) {
      if (pane && pane !== from && pane.scrollTop !== from.scrollTop)
        pane.scrollTop = from.scrollTop;
    }
  };

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
      {inline ? (
        <section ref={scroller} className="app-md-scroll">
          <div className="app-md-inline">
            {rows.rows.map((row, index) => {
              const folded = fold(index);
              if (folded !== undefined) return folded;
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
        </section>
      ) : (
        <div className="app-md-panes">
          <section
            ref={left}
            className="app-md-scroll"
            aria-label="Before"
            onScroll={() => follow(left.current)}
          >
            <div className="app-md-grid">
              {rows.rows.map((row, index) => {
                const folded = fold(index, true);
                const key = `${index}-${row.kind}`;
                if (folded !== undefined)
                  return (
                    folded && (
                      <div key={key} className="app-md-cell">
                        {folded}
                      </div>
                    )
                  );
                const marked = rows.marked[index];
                if (!marked) return null;
                return (
                  <div key={key} className="dl-md app-md-cell">
                    {row.kind === "inserted"
                      ? startsRun(rows.rows, index) && <div className="app-md-gap is-inserted" />
                      : cell(marked.left, blockClass(row, marked, "left"), "left", row.left)}
                  </div>
                );
              })}
            </div>
          </section>
          <div ref={strips} className="app-md-strips" aria-hidden="true">
            <div className="app-md-grid">
              {rows.rows.map((row, index) => {
                const folded = fold(index);
                const key = `${index}-${row.kind}`;
                if (folded !== undefined)
                  return folded && <div key={key} className="app-md-strip" />;
                if (!rows.marked[index]) return null;
                return <div key={key} className={`app-md-strip is-${row.kind}`} />;
              })}
            </div>
          </div>
          <section
            ref={scroller}
            className="app-md-scroll"
            aria-label="After"
            onScroll={() => follow(scroller.current)}
          >
            <div className="app-md-grid">
              {rows.rows.map((row, index) => {
                const folded = fold(index);
                const key = `${index}-${row.kind}`;
                if (folded !== undefined)
                  return (
                    folded && (
                      <div key={key} className="app-md-cell" data-row={index}>
                        {folded}
                      </div>
                    )
                  );
                const marked = rows.marked[index];
                if (!marked) return null;
                return (
                  <div key={key} className="dl-md app-md-cell" data-row={index}>
                    {row.kind === "deleted"
                      ? startsRun(rows.rows, index) && <div className="app-md-gap is-deleted" />
                      : cell(marked.right, blockClass(row, marked, "right"), "right", row.right)}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
