import type { Root } from "hast";
import {
  type PointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Backend, DiffSide, FileDiff } from "../api";
import { Stripe } from "../diff/DiffViewer";
import { LeftHead, RightHead } from "../diff/FileHead";
import {
  clampRatio,
  diffDividerRatioKey,
  foldContext,
  layout,
  type Mark,
  type Range,
  rowTop,
} from "../diff/geometry";
import { StoreContext } from "../state/context";
import { type Block, blocks, parse } from "./blocks";
import { type Marked, markRow } from "./mark";
import { match, type Row } from "./match";
import { type Images, render, sources } from "./render";

export type MarkdownRows = { rows: Row[]; marked: Marked[]; changed: number[] };

export function markdownMarks(rows: Row[], hidden: Range[]): { marks: Mark[]; rows: number } {
  const map = layout(rows.length, hidden);
  const marks: Mark[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row && row.kind !== "equal") {
      marks.push({ kind: row.kind, row: rowTop(map, i) });
    }
  }
  return { marks, rows: map.rows };
}

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
  backend?: Backend,
  repo?: string,
): Record<Side | "merged", Images> {
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
    if (!repo || !backend) return;
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
  activeSearchRow?: number | null;
  backend?: Backend;
  onCurrent: (index: number) => void;
};

export function MarkdownDiff({
  diff,
  rows,
  inline,
  collapse,
  current,
  activeSearchRow,
  backend: explicitBackend,
  onCurrent,
}: Props) {
  const store = useContext(StoreContext);
  const backend = explicitBackend ?? store?.getState().backend;
  const repo = store?.getState().repo?.path;
  const [ratio, setRatio] = useState(0.5);
  const lastRatio = useRef(0.5);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeDrag = useRef<{
    pointerId: number;
    move: (clientX: number) => void;
  } | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      dragCleanup.current?.();
    };
  }, []);

  useEffect(() => {
    if (!backend) return;
    let active = true;
    void backend
      .call("get_ui_value", { key: diffDividerRatioKey })
      .then((saved) => {
        if (!active || !saved) return;
        const num = Number(saved);
        if (Number.isFinite(num)) {
          const next = clampRatio(num, 0.2, 0.8, containerRef.current?.clientWidth, 200, 24);
          lastRatio.current = next;
          setRatio(next);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [backend]);

  const saveRatio = useCallback(
    (next: number) => {
      if (!backend) return;
      void backend
        .call("set_ui_value", { key: diffDividerRatioKey, value: String(next) })
        .catch(() => undefined);
    },
    [backend],
  );

  const onDoubleClick = useCallback(() => {
    lastRatio.current = 0.5;
    setRatio(0.5);
    saveRatio(0.5);
  }, [saveRatio]);

  const onPointerDown = (event: PointerEvent<HTMLHRElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragCleanup.current?.();

    const target = event.currentTarget;
    const pointerId = event.pointerId;
    try {
      target.setPointerCapture(pointerId);
    } catch {}

    const container = containerRef.current;
    const containerWidth = container?.clientWidth ?? 0;
    const width = Math.max(containerWidth - 24, 1);
    const startX = event.clientX;
    const startRatio = lastRatio.current;

    const move = (clientX: number) => {
      const delta = clientX - startX;
      const currentContainer = containerRef.current;
      const next = clampRatio(
        startRatio + delta / width,
        0.2,
        0.8,
        currentContainer?.clientWidth,
        200,
        24,
      );
      lastRatio.current = next;
      setRatio(next);
    };

    activeDrag.current = { pointerId, move };

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      activeDrag.current = null;
      dragCleanup.current = null;
      try {
        if (target.hasPointerCapture(pointerId)) {
          target.releasePointerCapture(pointerId);
        }
      } catch {}
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerEnd);
      window.removeEventListener("pointercancel", onWindowPointerEnd);
      window.removeEventListener("blur", onWindowPointerEnd);
      saveRatio(lastRatio.current);
    };

    const onWindowPointerMove = (e: globalThis.PointerEvent) => {
      if (e.pointerId === pointerId) {
        move(e.clientX);
      }
    };

    const onWindowPointerEnd = (e: Event) => {
      if ("pointerId" in e && (e as globalThis.PointerEvent).pointerId !== pointerId) return;
      cleanup();
    };

    dragCleanup.current = cleanup;
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerEnd);
    window.addEventListener("pointercancel", onWindowPointerEnd);
    window.addEventListener("blur", onWindowPointerEnd);
  };

  const onPointerMove = (event: PointerEvent<HTMLHRElement>) => {
    if (activeDrag.current && event.pointerId === activeDrag.current.pointerId) {
      activeDrag.current.move(event.clientX);
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLHRElement>) => {
    if (activeDrag.current && event.pointerId === activeDrag.current.pointerId) {
      dragCleanup.current?.();
    }
  };

  const onPointerCancel = (event: PointerEvent<HTMLHRElement>) => {
    if (activeDrag.current && event.pointerId === activeDrag.current.pointerId) {
      dragCleanup.current?.();
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLHRElement>) => {
    const step = event.key === "ArrowLeft" ? -0.05 : event.key === "ArrowRight" ? 0.05 : 0;
    if (!step) return;
    event.preventDefault();
    const next = clampRatio(ratio + step, 0.2, 0.8, containerRef.current?.clientWidth, 200, 24);
    lastRatio.current = next;
    setRatio(next);
    saveRatio(next);
  };

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
  const { marks, rows: totalRows } = useMemo(
    () => markdownMarks(rows.rows, hidden),
    [rows.rows, hidden],
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
  const images = useImages(diff, trees, backend, repo);
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
  }, [inline]);

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
    target?.scrollIntoView?.({ block: "center" });
  }, [current]);

  useEffect(() => {
    if (activeSearchRow === null || activeSearchRow === undefined) return;
    const fold = hidden.find(([from, to]) => activeSearchRow >= from && activeSearchRow < to);
    if (fold) {
      setExpanded((set) => new Set(set).add(fold[0]));
    }
    const target = scroller.current?.querySelector(`[data-row="${activeSearchRow}"]`);
    target?.scrollIntoView?.({ block: "center" });
  }, [activeSearchRow, hidden]);

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
        <div
          className="app-md-heads"
          style={{
            gridTemplateColumns: `minmax(200px, ${ratio}fr) var(--space-24) minmax(200px, ${1 - ratio}fr)`,
          }}
        >
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
        <div className="app-md-right">
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
          <Stripe marks={marks} rows={totalRows} />
        </div>
      ) : (
        <div
          ref={containerRef}
          className="app-md-panes"
          style={{
            gridTemplateColumns: `minmax(200px, ${ratio}fr) var(--space-24) minmax(200px, ${1 - ratio}fr)`,
          }}
        >
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
          <div ref={strips} className="app-md-strips dl-divider app-diff-divider">
            <div className="app-md-grid" aria-hidden="true">
              {rows.rows.map((row, index) => {
                const folded = fold(index);
                const key = `${index}-${row.kind}`;
                if (folded !== undefined)
                  return folded && <div key={key} className="app-md-strip" />;
                if (!rows.marked[index]) return null;
                return <div key={key} className={`app-md-strip is-${row.kind}`} />;
              })}
            </div>
            <hr
              className="app-diff-handle"
              aria-orientation="vertical"
              aria-label="Resize diff panes"
              aria-valuenow={Math.round(ratio * 100)}
              aria-valuemin={20}
              aria-valuemax={80}
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onLostPointerCapture={onPointerCancel}
              onDoubleClick={onDoubleClick}
              onKeyDown={onKeyDown}
            />
          </div>
          <div className="app-md-right">
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
            <Stripe marks={marks} rows={totalRows} />
          </div>
        </div>
      )}
    </section>
  );
}
