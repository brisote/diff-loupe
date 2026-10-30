import type { EditorView } from "@codemirror/view";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Block } from "../api/generated/Block";
import type { FileDiff } from "../api/generated/FileDiff";
import type { Highlight } from "../api/generated/Highlight";
import { CodePane, type Decorate } from "./CodePane";
import { diffDecorations } from "./decorations";
import { LeftHead, RightHead } from "./FileHead";
import {
  anchors,
  connector,
  folds,
  type Layout,
  layout,
  lineAtRow,
  lineCount,
  lineHeight,
  lineStates,
  type Mark,
  mapLine,
  markHeight,
  type Range,
  rowTop,
  type Side,
  stripeRuns,
} from "./geometry";
import { LineNumbers } from "./LineNumbers";

const sides: Side[] = ["left", "right"];

type Props = {
  diff: FileDiff;
  current: number;
  collapse: boolean;
  sync: boolean;
  highlight: Highlight;
  onCurrent: (index: number) => void;
};

type Scroll = { left: number; right: number; height: number };

export function DiffViewer({ diff, current, collapse, sync, highlight, onCurrent }: Props) {
  const views = useRef<Record<string, EditorView | null>>({ left: null, right: null });
  const echo = useRef<Record<string, number | null>>({ left: null, right: null });
  const frame = useRef(0);
  const [scroll, setScroll] = useState<Scroll>({ left: 0, right: 0, height: 0 });
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [folding, setFolding] = useState(collapse);
  if (folding !== collapse) {
    setFolding(collapse);
    setExpanded(new Set());
  }
  const leftLines = useMemo(() => lineCount(diff.left.text), [diff.left.text]);
  const rightLines = useMemo(() => lineCount(diff.right.text), [diff.right.text]);
  const points = useMemo(
    () => anchors(diff.blocks, leftLines, rightLines),
    [diff.blocks, leftLines, rightLines],
  );
  const allFolds = useMemo(
    () => folds(diff.blocks, leftLines, rightLines),
    [diff.blocks, leftLines, rightLines],
  );
  const active = useMemo(
    () => (collapse ? allFolds.filter((fold) => !expanded.has(fold.left[0])) : []),
    [collapse, allFolds, expanded],
  );
  const hidden = useMemo<Record<Side, Range[]>>(
    () => ({ left: active.map((f) => f.left), right: active.map((f) => f.right) }),
    [active],
  );
  const maps = useMemo<Record<Side, Layout>>(
    () => ({ left: layout(leftLines, hidden.left), right: layout(rightLines, hidden.right) }),
    [leftLines, rightLines, hidden],
  );
  const states = useMemo(
    () => ({
      left: lineStates(diff.blocks, "left", leftLines),
      right: lineStates(diff.blocks, "right", rightLines),
    }),
    [diff.blocks, leftLines, rightLines],
  );
  const marks = useMemo(
    () =>
      diff.blocks.map((block) => ({ kind: block.kind, row: rowTop(maps.right, block.rightStart) })),
    [diff.blocks, maps.right],
  );
  const live = useRef({ points, maps, hidden, sync });
  live.current = { points, maps, hidden, sync };

  const measure = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const left = views.current.left?.scrollDOM;
      const right = views.current.right?.scrollDOM;
      setScroll({
        left: left?.scrollTop ?? 0,
        right: right?.scrollTop ?? 0,
        height: right?.clientHeight ?? 0,
      });
    });
  }, []);

  const onView = useCallback(
    (id: string, view: EditorView | null) => {
      views.current[id] = view;
      measure();
    },
    [measure],
  );

  const onScroll = useCallback(
    (id: string) => {
      const side = id as Side;
      const other: Side = side === "left" ? "right" : "left";
      const source = views.current[side]?.scrollDOM;
      const target = views.current[other]?.scrollDOM;
      const expected = echo.current[side];
      if (expected !== null && expected !== undefined) {
        echo.current[side] = null;
        if (source && Math.abs(source.scrollTop - expected) < 2) {
          measure();
          return;
        }
      }
      const { points: anchorsNow, maps: mapsNow, hidden: hiddenNow, sync: syncNow } = live.current;
      if (syncNow && source && target) {
        const centerRow = (source.scrollTop + source.clientHeight / 2) / lineHeight;
        const line = lineAtRow(mapsNow[side], centerRow, hiddenNow[side]);
        const mapped = mapLine(line, anchorsNow, side);
        const whole = Math.floor(mapped);
        const start = rowTop(mapsNow[other], whole);
        const row = start + (mapped - whole) * (rowTop(mapsNow[other], whole + 1) - start);
        const top = clampTop(target, row * lineHeight - target.clientHeight / 2);
        if (Math.abs(target.scrollTop - top) >= 1) {
          echo.current[other] = top;
          target.scrollTop = top;
        }
      }
      measure();
    },
    [measure],
  );

  const reveal = useCallback(
    (index: number) => {
      const block = diff.blocks[index];
      if (!block) return;
      for (const side of sides) {
        const element = views.current[side]?.scrollDOM;
        if (!element) continue;
        const line = side === "left" ? block.leftStart : block.rightStart;
        const top = clampTop(
          element,
          rowTop(live.current.maps[side], line) * lineHeight - element.clientHeight / 3,
        );
        if (Math.abs(element.scrollTop - top) >= 1) {
          echo.current[side] = top;
          element.scrollTop = top;
        }
      }
      measure();
    },
    [diff.blocks, measure],
  );
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  useEffect(() => {
    if (current < 0) return;
    const frameId = requestAnimationFrame(() => revealRef.current(current));
    return () => cancelAnimationFrame(frameId);
  }, [current]);

  useEffect(() => {
    const resize = new ResizeObserver(measure);
    const right = views.current.right?.scrollDOM;
    if (right) resize.observe(right);
    return () => resize.disconnect();
  }, [measure]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F7" || document.querySelector(".app-modal")) return;
      event.preventDefault();
      const count = diff.blocks.length;
      if (count === 0) return;
      onCurrent(event.shiftKey ? Math.max(current - 1, 0) : Math.min(current + 1, count - 1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [diff.blocks.length, current, onCurrent]);

  const painted = highlight !== "none";
  const decorateLeft = useCallback<Decorate>(
    (doc) => (painted ? diffDecorations(doc, diff.blocks, "left") : []),
    [painted, diff.blocks],
  );
  const decorateRight = useCallback<Decorate>(
    (doc) => (painted ? diffDecorations(doc, diff.blocks, "right") : []),
    [painted, diff.blocks],
  );
  const activeRef = useRef(active);
  activeRef.current = active;
  const expand = useCallback((index: number) => {
    const fold = activeRef.current[index];
    if (fold) setExpanded((set) => new Set(set).add(fold.left[0]));
  }, []);

  const y = (side: Side, line: number) =>
    rowTop(maps[side], line) * lineHeight - (side === "left" ? scroll.left : scroll.right);
  const shown = diff.blocks.filter((block) => {
    const top = Math.min(y("left", block.leftStart), y("right", block.rightStart));
    const bottom = Math.max(y("left", block.leftEnd), y("right", block.rightEnd));
    return bottom >= 0 && top <= scroll.height;
  });
  const numberClass = (side: Side) => (line: number) => {
    const state = painted ? states[side][line] : null;
    return state ? ` is-${state.kind}${state.words ? " has-words" : ""}` : "";
  };
  return (
    <section className="app-diff" aria-label="Side-by-side diff">
      <div className="dl-filehead app-diff-head-left">
        <LeftHead diff={diff} />
      </div>
      <div className="dl-filehead app-diff-head-middle" />
      <div className="dl-filehead app-diff-head-right">
        <RightHead diff={diff} />
      </div>
      <CodePane
        id="left"
        text={diff.left.text}
        path={diff.oldPath ?? diff.path}
        label="Before"
        decorate={decorateLeft}
        hidden={hidden.left}
        onView={onView}
        onScroll={onScroll}
        onExpand={expand}
      />
      <LineNumbers
        map={maps.left}
        label={(line) => String(line + 1)}
        lineClass={numberClass("left")}
        top={scroll.left}
        height={scroll.height}
        className="is-left"
      />
      <div className="dl-divider app-diff-divider" aria-hidden="true">
        <svg>
          <title>Change connectors</title>
          {diff.left.exists &&
            diff.right.exists &&
            shown.map((block) => (
              <path
                key={`${block.leftStart}-${block.rightStart}`}
                className={`dl-conn ${connectorClass(block)}`}
                d={connector(
                  y("left", block.leftStart),
                  y("left", block.leftEnd),
                  y("right", block.rightStart),
                  y("right", block.rightEnd),
                )}
              />
            ))}
        </svg>
      </div>
      <LineNumbers
        map={maps.right}
        label={(line) => String(line + 1)}
        lineClass={numberClass("right")}
        top={scroll.right}
        height={scroll.height}
        className="is-right"
      />
      <div className="app-diff-right">
        <CodePane
          id="right"
          text={diff.right.text}
          path={diff.path}
          label="After"
          decorate={decorateRight}
          hidden={hidden.right}
          onView={onView}
          onScroll={onScroll}
          onExpand={expand}
        />
        <Stripe marks={marks} rows={maps.right.rows} />
      </div>
    </section>
  );
}

export function clampTop(element: HTMLElement, top: number): number {
  const limit = Math.max(0, element.scrollHeight - element.clientHeight);
  return Math.min(limit, Math.max(0, top));
}

function connectorClass(block: Block): string {
  return block.kind === "modified" && block.hasWords ? "is-modified-line" : `is-${block.kind}`;
}

const markClass = {
  inserted: "dl-mark-ins",
  deleted: "dl-mark-del",
  modified: "dl-mark-mod",
} as const;

export const Stripe = memo(function Stripe({ marks, rows }: { marks: Mark[]; rows: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setHeight(element.clientHeight);
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  const runs = useMemo(() => stripeRuns(marks, rows, height), [marks, rows, height]);
  const share = (row: number) => `${(row / Math.max(rows, 1)) * 100}%`;
  return (
    <div ref={ref} className="dl-stripe" aria-hidden="true">
      {runs.map((run) => (
        <i
          key={`${run.kind}-${run.from}`}
          className={markClass[run.kind]}
          style={
            run.to > run.from
              ? {
                  top: share(run.from),
                  height: `calc(${share(run.to - run.from)} + ${markHeight}px)`,
                }
              : { top: share(run.from) }
          }
        />
      ))}
    </div>
  );
});
