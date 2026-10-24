import type { Range as Ranged } from "@codemirror/state";
import { Decoration, type EditorView } from "@codemirror/view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff } from "../api/generated/FileDiff";
import type { Highlight } from "../api/generated/Highlight";
import { CodePane, type Decorate } from "./CodePane";
import { clampTop, Stripe } from "./DiffViewer";
import { LeftHead, RightHead } from "./FileHead";
import { foldContext, foldMinimum, layout, lineHeight, type Range, rowTop } from "./geometry";
import { LineNumbers } from "./LineNumbers";
import { buildUnified, type UnifiedRow } from "./unified";

type Props = {
  diff: FileDiff;
  current: number;
  collapse: boolean;
  highlight: Highlight;
  onCurrent: (index: number) => void;
};

export function contextFolds(rows: UnifiedRow[]): Range[] {
  if (rows.every((row) => row.kind === "context")) return [];
  const found: Range[] = [];
  let start = 0;
  for (let i = 0; i <= rows.length; i += 1) {
    if (i < rows.length && rows[i]?.kind === "context") continue;
    const end = i;
    const before = start === 0 ? 0 : foldContext;
    const after = 0;
    if (end - start - before - after >= foldMinimum) found.push([start + before, end - after]);
    start = i + 1;
  }
  return found;
}

export function UnifiedViewer({ diff, current, collapse, highlight, onCurrent }: Props) {
  const view = useRef<EditorView | null>(null);
  const frame = useRef(0);
  const [scroll, setScroll] = useState({ top: 0, height: 0 });
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [folding, setFolding] = useState(collapse);
  if (folding !== collapse) {
    setFolding(collapse);
    setExpanded(new Set());
  }
  const unified = useMemo(() => buildUnified(diff), [diff]);
  const allFolds = useMemo(() => contextFolds(unified.rows), [unified.rows]);
  const hidden = useMemo(
    () => (collapse ? allFolds.filter((fold) => !expanded.has(fold[0])) : []),
    [collapse, allFolds, expanded],
  );
  const map = useMemo(() => layout(unified.rows.length, hidden), [unified.rows.length, hidden]);
  const marks = useMemo(
    () => unified.blocks.map((block) => ({ kind: block.kind, row: rowTop(map, block.start) })),
    [unified.blocks, map],
  );

  const measure = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const element = view.current?.scrollDOM;
      setScroll({ top: element?.scrollTop ?? 0, height: element?.clientHeight ?? 0 });
    });
  }, []);
  const onView = useCallback(
    (_id: string, created: EditorView | null) => {
      view.current = created;
      measure();
    },
    [measure],
  );
  const onScroll = useCallback(() => measure(), [measure]);
  const mapRef = useRef(map);
  mapRef.current = map;
  const blocksRef = useRef(unified.blocks);
  blocksRef.current = unified.blocks;
  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      const block = blocksRef.current[current];
      const element = view.current?.scrollDOM;
      if (!block || !element) return;
      element.scrollTop = clampTop(
        element,
        rowTop(mapRef.current, block.start) * lineHeight - element.clientHeight / 3,
      );
      measure();
    });
    return () => cancelAnimationFrame(frameId);
  }, [current, measure]);

  useEffect(() => {
    const resize = new ResizeObserver(measure);
    const element = view.current?.scrollDOM;
    if (element) resize.observe(element);
    return () => resize.disconnect();
  }, [measure]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F7" || document.querySelector(".app-modal")) return;
      event.preventDefault();
      const count = unified.blocks.length;
      if (count === 0) return;
      onCurrent(event.shiftKey ? Math.max(current - 1, 0) : Math.min(current + 1, count - 1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [unified.blocks.length, current, onCurrent]);

  const painted = highlight !== "none";
  const decorate = useCallback<Decorate>(
    (doc) => {
      if (!painted) return [];
      const ranges: Ranged<Decoration>[] = [];
      unified.rows.forEach((row, index) => {
        if (row.kind === "context" || index >= doc.lines) return;
        const className = `cm-diff-${row.kind}${row.words ? " has-words" : ""}`;
        ranges.push(Decoration.line({ class: className }).range(doc.line(index + 1).from));
      });
      for (const mark of unified.marks) {
        if (mark.to <= doc.length)
          ranges.push(Decoration.mark({ class: mark.className }).range(mark.from, mark.to));
      }
      return ranges;
    },
    [painted, unified],
  );
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const expand = useCallback((index: number) => {
    const fold = hiddenRef.current[index];
    if (fold) setExpanded((set) => new Set(set).add(fold[0]));
  }, []);
  const numberClass = (line: number) => {
    const row = unified.rows[line];
    if (!painted || !row || row.kind === "context") return "";
    return ` is-${row.kind}${row.words ? " has-words" : ""}`;
  };

  return (
    <section className="app-unified" aria-label="Unified diff">
      <div className="dl-filehead app-unified-head">
        <LeftHead diff={diff} />
        <span className="dl-crumb-sep">→</span>
        <RightHead diff={diff} />
      </div>
      <LineNumbers
        map={map}
        label={(line) => String(unified.rows[line]?.old ?? "")}
        lineClass={numberClass}
        top={scroll.top}
        height={scroll.height}
        className="is-old"
      />
      <LineNumbers
        map={map}
        label={(line) => String(unified.rows[line]?.new ?? "")}
        lineClass={numberClass}
        top={scroll.top}
        height={scroll.height}
        className="is-new"
      />
      <div className="app-diff-right">
        <CodePane
          id="unified"
          text={unified.text}
          path={diff.path}
          label="Unified"
          decorate={decorate}
          hidden={hidden}
          onView={onView}
          onScroll={onScroll}
          onExpand={expand}
        />
        <Stripe marks={marks} rows={map.rows} />
      </div>
    </section>
  );
}
