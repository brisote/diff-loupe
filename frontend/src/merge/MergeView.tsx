import type { Range as Ranged, Text } from "@codemirror/state";
import { Decoration, type EditorView } from "@codemirror/view";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MergeFile } from "../api";
import type { MergeChunk } from "../api/generated/MergeChunk";
import { CodePane, type Decorate } from "../diff/CodePane";
import { clampTop } from "../diff/DiffViewer";
import {
  anchors,
  connector,
  layout,
  lineCount,
  lineHeight,
  mapLine,
  rowTop,
} from "../diff/geometry";
import { LineNumbers } from "../diff/LineNumbers";
import { Dialog } from "../lib/dialog";
import { Icon } from "../lib/icon";
import {
  acceptSide,
  applyNonConflicting,
  type ChunkState,
  ignoreSide,
  initialStates,
  isResolved,
  type MergeEdit,
  type MergeSide,
  remaining,
  remainingLabel,
  resolveSimple,
  resultLines,
  unresolvedText,
} from "./model";
import { chunks, chunkUpdate, ResultPane } from "./ResultPane";

export type ChangeType = "inserted" | "deleted" | "modified" | "conflict";

type Pane = "ours" | "result" | "theirs";
type Mark = ChangeType | "resolved";
type Span = { start: number; end: number; type: Mark };

export function changeType(chunk: MergeChunk): ChangeType {
  if (chunk.kind === "conflict") return "conflict";
  const sideEmpty =
    chunk.kind === "theirs"
      ? chunk.theirsEnd === chunk.theirsStart
      : chunk.oursEnd === chunk.oursStart;
  if (chunk.baseEnd === chunk.baseStart) return "inserted";
  return sideEmpty ? "deleted" : "modified";
}

function spanKey(spans: Span[]): string {
  return spans.map((span) => `${span.start}-${span.end}-${span.type}`).join();
}

function useStableSpans(spans: Span[]): Span[] {
  const stable = useRef(spans);
  if (spanKey(stable.current) !== spanKey(spans)) stable.current = spans;
  return stable.current;
}

export function spanDecorations(doc: Text, spans: Span[]): Ranged<Decoration>[] {
  const ranges: Ranged<Decoration>[] = [];
  for (const span of spans) {
    if (span.end > span.start) {
      for (let line = span.start; line < span.end && line < doc.lines; line += 1) {
        ranges.push(
          Decoration.line({ class: `cm-diff-${span.type}` }).range(doc.line(line + 1).from),
        );
      }
    } else if (doc.lines > 0) {
      const above = span.start > 0 && span.start <= doc.lines;
      ranges.push(
        Decoration.line({
          class: `cm-gap-${above ? "after" : "before"} cm-gap-${span.type}`,
        }).range(above ? doc.line(span.start).from : 0),
      );
    }
  }
  return ranges.sort((a, b) => a.from - b.from);
}

function sideRange(chunk: MergeChunk, side: MergeSide): [number, number] {
  return side === "ours" ? [chunk.oursStart, chunk.oursEnd] : [chunk.theirsStart, chunk.theirsEnd];
}

function pendingOn(state: ChunkState, side: MergeSide): boolean {
  return !isResolved(state) && state[side] === "pending";
}

function sideMark(state: ChunkState, side: MergeSide): Mark | null {
  if (pendingOn(state, side)) return changeType(state.chunk);
  if (state[side] === "none") return null;
  return "resolved";
}

function resultMark(state: ChunkState): Mark {
  if (!isResolved(state)) return changeType(state.chunk);
  return "resolved";
}

type Props = {
  file: MergeFile;
  oursLabel: string;
  theirsLabel: string;
  embedded: boolean;
  onApply: (text: string) => void;
  onAccept: (side: MergeSide) => void;
  onCancel?: () => void;
  cancelRef?: RefObject<(() => void) | null>;
};

export function MergeView({
  file,
  oursLabel,
  theirsLabel,
  embedded,
  onApply,
  onAccept,
  onCancel,
  cancelRef,
}: Props) {
  const initialChunks = useMemo(() => initialStates(file), [file]);
  const [states, setStates] = useState<ChunkState[]>(initialChunks);
  const [doc, setDoc] = useState<Text | null>(null);
  const [current, setCurrent] = useState(-1);
  const [confirm, setConfirm] = useState(false);
  const [discard, setDiscard] = useState(false);
  const views = useRef<Record<Pane, EditorView | null>>({ ours: null, result: null, theirs: null });
  const echo = useRef<Record<Pane, number | null>>({ ours: null, result: null, theirs: null });
  const frame = useRef(0);
  const [scroll, setScroll] = useState<Record<Pane, number> & { height: number }>({
    ours: 0,
    result: 0,
    theirs: 0,
    height: 0,
  });
  const statesRef = useRef(states);
  statesRef.current = states;

  const oursLines = useMemo(() => lineCount(file.ours), [file.ours]);
  const theirsLines = useMemo(() => lineCount(file.theirs), [file.theirs]);
  const resultCount = doc
    ? doc.lines -
      (doc.length > 0 && doc.sliceString(doc.length - 1) === "\n" ? 1 : 0) -
      (doc.length === 0 ? 1 : 0)
    : lineCount(file.base);
  const results = useMemo(
    () => (doc ? states.map((state) => resultLines(doc, state)) : []),
    [doc, states],
  );
  const pairs = useMemo(() => {
    const block = (left: [number, number], right: [number, number]) => ({
      leftStart: left[0],
      leftEnd: left[1],
      rightStart: right[0],
      rightEnd: right[1],
    });
    return {
      ours: anchors(
        states.map((state, index) =>
          block(sideRange(state.chunk, "ours"), results[index] ?? [0, 0]),
        ),
        oursLines,
        resultCount,
      ),
      theirs: anchors(
        states.map((state, index) =>
          block(results[index] ?? [0, 0], sideRange(state.chunk, "theirs")),
        ),
        resultCount,
        theirsLines,
      ),
    };
  }, [states, results, oursLines, theirsLines, resultCount]);
  const maps = useMemo(
    () => ({
      ours: layout(oursLines, []),
      result: layout(resultCount, []),
      theirs: layout(theirsLines, []),
    }),
    [oursLines, resultCount, theirsLines],
  );
  const live = useRef({ pairs, maps });
  live.current = { pairs, maps };

  const measure = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const top = (pane: Pane) => views.current[pane]?.scrollDOM.scrollTop ?? 0;
      setScroll({
        ours: top("ours"),
        result: top("result"),
        theirs: top("theirs"),
        height: views.current.result?.scrollDOM.clientHeight ?? 0,
      });
    });
  }, []);

  const scrollTo = useCallback((pane: Pane, line: number, ratio: number) => {
    const element = views.current[pane]?.scrollDOM;
    if (!element) return;
    const whole = Math.floor(line);
    const start = rowTop(live.current.maps[pane], whole);
    const row = start + (line - whole) * (rowTop(live.current.maps[pane], whole + 1) - start);
    const top = clampTop(element, row * lineHeight - element.clientHeight * ratio);
    if (Math.abs(element.scrollTop - top) >= 1) {
      echo.current[pane] = top;
      element.scrollTop = top;
    }
  }, []);

  const onScrollPane = useCallback(
    (pane: Pane) => {
      const source = views.current[pane]?.scrollDOM;
      const expected = echo.current[pane];
      if (expected !== null) {
        echo.current[pane] = null;
        if (source && Math.abs(source.scrollTop - expected) < 2) {
          measure();
          return;
        }
      }
      if (source) {
        const center = (source.scrollTop + source.clientHeight / 2) / lineHeight;
        const { pairs: now } = live.current;
        const result =
          pane === "result"
            ? center
            : pane === "ours"
              ? mapLine(center, now.ours, "left")
              : mapLine(center, now.theirs, "right");
        if (pane !== "result") scrollTo("result", result, 0.5);
        if (pane !== "ours") scrollTo("ours", mapLine(result, now.ours, "right"), 0.5);
        if (pane !== "theirs") scrollTo("theirs", mapLine(result, now.theirs, "left"), 0.5);
      }
      measure();
    },
    [measure, scrollTo],
  );

  const onSideView = useCallback(
    (id: string, view: EditorView | null) => {
      views.current[id as Pane] = view;
      measure();
    },
    [measure],
  );
  const onResultView = useCallback(
    (view: EditorView | null) => {
      views.current.result = view;
      setDoc(view?.state.doc ?? null);
      measure();
    },
    [measure],
  );
  const onSideScroll = useCallback((id: string) => onScrollPane(id as Pane), [onScrollPane]);
  const onResultScroll = useCallback(() => onScrollPane("result"), [onScrollPane]);
  const onEdit = useCallback((view: EditorView) => {
    setStates(chunks(view));
    setDoc(view.state.doc);
  }, []);

  const run = (edit: MergeEdit | null) => {
    const view = views.current.result;
    if (!edit || !view) return;
    view.dispatch({ changes: edit.changes, ...chunkUpdate(edit.states) });
  };
  const resultDoc = () => views.current.result?.state.doc;
  const accept = (index: number, side: MergeSide) => {
    const now = resultDoc();
    if (now) run(acceptSide(file, now, statesRef.current, index, side));
  };
  const ignore = (index: number, side: MergeSide) =>
    views.current.result?.dispatch(chunkUpdate(ignoreSide(statesRef.current, index, side)));
  const applyAll = (only?: MergeSide) => {
    const now = resultDoc();
    if (now) run(applyNonConflicting(file, now, statesRef.current, only));
  };
  const simple = () => {
    const now = resultDoc();
    if (now) run(resolveSimple(now, statesRef.current));
  };
  const reveal = useCallback(
    (index: number) => {
      const state = statesRef.current[index];
      const now = views.current.result?.state.doc;
      if (!state || !now) return;
      scrollTo("result", resultLines(now, state)[0], 1 / 3);
      scrollTo("ours", state.chunk.oursStart, 1 / 3);
      scrollTo("theirs", state.chunk.theirsStart, 1 / 3);
      measure();
    },
    [measure, scrollTo],
  );
  const move = useCallback(
    (step: 1 | -1) => {
      const open = statesRef.current
        .map((state, index) => (isResolved(state) ? -1 : index))
        .filter((index) => index >= 0);
      if (open.length === 0) return;
      const next =
        step === 1
          ? (open.find((index) => index > current) ?? open[open.length - 1])
          : ([...open].reverse().find((index) => index < current) ?? open[0]);
      if (next === undefined) return;
      setCurrent(next);
      reveal(next);
    },
    [current, reveal],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F7") return;
      if (embedded && document.querySelector(".app-modal")) return;
      event.preventDefault();
      move(event.shiftKey ? -1 : 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [embedded, move]);

  useEffect(() => {
    const resize = new ResizeObserver(measure);
    const element = views.current.result?.scrollDOM;
    if (element) resize.observe(element);
    return () => resize.disconnect();
  }, [measure]);

  const sideSpans = (side: MergeSide): Span[] =>
    states.flatMap((state) => {
      const type = sideMark(state, side);
      if (!type) return [];
      const [start, end] = sideRange(state.chunk, side);
      return [{ start, end, type }];
    });
  const oursSpans = useStableSpans(sideSpans("ours"));
  const theirsSpans = useStableSpans(sideSpans("theirs"));
  const resultSpans = useStableSpans(
    states.map((state, index) => {
      const [start, end] = results[index] ?? [0, 0];
      return { start, end, type: resultMark(state) };
    }),
  );
  const decorateOurs = useCallback<Decorate>(
    (text) => spanDecorations(text, oursSpans),
    [oursSpans],
  );
  const decorateTheirs = useCallback<Decorate>(
    (text) => spanDecorations(text, theirsSpans),
    [theirsSpans],
  );
  const decorateResult = useCallback<Decorate>(
    (text) => spanDecorations(text, resultSpans),
    [resultSpans],
  );
  const noFolds = useMemo(() => [], []);
  const noExpand = useCallback(() => undefined, []);

  const y = (pane: Pane, line: number) => rowTop(maps[pane], line) * lineHeight - scroll[pane];
  const numberClass = (spans: Span[]) => (line: number) => {
    const span = spans.find((s) => line >= s.start && line < s.end);
    return span ? ` is-${span.type}` : "";
  };
  const { changes, conflicts } = remaining(states);
  const unresolved = changes + conflicts;

  const chevrons = (side: MergeSide) => {
    const starts = new Set(
      states
        .filter((state) => pendingOn(state, side))
        .map((state) => sideRange(state.chunk, side)[0]),
    );
    return states.flatMap((state, index) => {
      if (!pendingOn(state, side)) return [];
      const [start, end] = sideRange(state.chunk, side);
      const below = end - start >= 2 || !starts.has(start + 1);
      const ignoreTop = y(side, below ? start + 1 : Math.max(start - 1, 0)) + 2;
      const top = y(side, start);
      if (top < -lineHeight || top > scroll.height) return [];
      const appends = state[side === "ours" ? "theirs" : "ours"] === "applied";
      const arrow =
        side === "ours"
          ? appends
            ? "diff-gutter-arrowRightDown"
            : "diff-gutter-arrowRight"
          : appends
            ? "diff-gutter-arrowLeftDown"
            : "diff-gutter-arrow";
      const place = side === "ours" ? { left: 4 } : { right: 4 };
      const key = `${side}-${state.chunk.baseStart}-${state.chunk.oursStart}-${state.chunk.theirsStart}`;
      return [
        <button
          key={`${key}-accept`}
          className="dl-chev"
          type="button"
          aria-label={side === "ours" ? "Accept left change" : "Accept right change"}
          title="Accept"
          style={{ ...place, top: top + 2 }}
          onClick={() => accept(index, side)}
        >
          <Icon name={arrow} />
        </button>,
        <button
          key={`${key}-ignore`}
          className="dl-chev"
          type="button"
          aria-label={side === "ours" ? "Ignore left change" : "Ignore right change"}
          title="Ignore"
          style={{ ...place, top: ignoreTop }}
          onClick={() => ignore(index, side)}
        >
          <Icon name="diff-gutter-remove" />
        </button>,
      ];
    });
  };
  const connectors = (side: MergeSide) =>
    states.flatMap((state, index) => {
      const type = sideMark(state, side);
      if (!type) return [];
      const [start, end] = sideRange(state.chunk, side);
      const [resultStart, resultEnd] = results[index] ?? [0, 0];
      const path =
        side === "ours"
          ? connector(
              y("ours", start),
              y("ours", end),
              y("result", resultStart),
              y("result", resultEnd),
            )
          : connector(
              y("result", resultStart),
              y("result", resultEnd),
              y("theirs", start),
              y("theirs", end),
            );
      return [
        <path
          key={`${side}-${state.chunk.baseStart}-${start}`}
          className={`dl-conn is-${type}`}
          d={path}
        />,
      ];
    });

  const tools: ({ label: string; icon: string; run: () => void } | "separator")[] = [
    {
      label: "Apply All Non-Conflicting Changes",
      icon: "diff-applyNotConflicts",
      run: () => applyAll(),
    },
    {
      label: "Apply Non-Conflicting Changes from the Left Side",
      icon: "diff-applyNotConflictsLeft",
      run: () => applyAll("ours"),
    },
    {
      label: "Apply Non-Conflicting Changes from the Right Side",
      icon: "diff-applyNotConflictsRight",
      run: () => applyAll("theirs"),
    },
    { label: "Resolve Simple Conflicts", icon: "diff-magicResolveToolbar", run: simple },
    "separator",
    { label: "Previous Difference ⇧F7", icon: "general-up", run: () => move(-1) },
    { label: "Next Difference F7", icon: "general-down", run: () => move(1) },
  ];

  const requestCancel = () => {
    const text = views.current.result?.state.doc.toString() ?? file.base;
    if (states !== initialChunks || text !== file.base) setDiscard(true);
    else onCancel?.();
  };
  if (cancelRef) cancelRef.current = onCancel ? requestCancel : null;

  const apply = () => {
    const text = views.current.result?.state.doc.toString();
    if (text === undefined) return;
    if (unresolved > 0 && !confirm) {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    onApply(text);
  };

  return (
    <section className={`app-merge ${embedded ? "is-embedded" : ""}`} aria-label="Merge">
      <div className="dl-toolbar app-merge-toolbar">
        {tools.map((tool) =>
          tool === "separator" ? (
            <span key={tool} className="dl-tsep" />
          ) : (
            <button
              key={tool.label}
              className="dl-tbtn"
              type="button"
              aria-label={tool.label}
              title={tool.label}
              onClick={tool.run}
            >
              <Icon name={tool.icon} />
            </button>
          ),
        )}
        <span className="dl-toolbar-spacer" />
        <span className="dl-tlabel" role="status" aria-label="Changes left">
          {remainingLabel(states)}
        </span>
      </div>
      <div className="app-merge-frame">
        <div className="dl-diff app-merge-grid">
          <div className="dl-pane-title app-merge-title-ours">
            <b>Yours</b> {oursLabel}
          </div>
          <div className="dl-pane-title app-merge-title-gap" />
          <div className="dl-pane-title app-merge-title-result">
            <b>Result</b>
          </div>
          <div className="dl-pane-title app-merge-title-gap" />
          <div className="dl-pane-title app-merge-title-theirs">
            <b>Theirs</b> {theirsLabel}
          </div>
          <CodePane
            id="ours"
            text={file.ours}
            path={file.path}
            label="Yours"
            decorate={decorateOurs}
            hidden={noFolds}
            onView={onSideView}
            onScroll={onSideScroll}
            onExpand={noExpand}
          />
          <LineNumbers
            map={maps.ours}
            label={(line) => String(line + 1)}
            lineClass={numberClass(oursSpans)}
            top={scroll.ours}
            height={scroll.height}
            className="is-left"
          />
          <div className="dl-divider app-merge-divider">
            <svg>
              <title>Left connectors</title>
              {connectors("ours")}
            </svg>
            {chevrons("ours")}
          </div>
          <LineNumbers
            map={maps.result}
            label={(line) => String(line + 1)}
            lineClass={numberClass(resultSpans)}
            top={scroll.result}
            height={scroll.height}
            className="is-right"
          />
          <div className="app-merge-result">
            <ResultPane
              text={file.base}
              initial={initialChunks}
              path={file.path}
              decorate={decorateResult}
              onView={onResultView}
              onScroll={onResultScroll}
              onEdit={onEdit}
            />
          </div>
          <div className="dl-divider app-merge-divider">
            <svg>
              <title>Right connectors</title>
              {connectors("theirs")}
            </svg>
            {chevrons("theirs")}
          </div>
          <LineNumbers
            map={maps.theirs}
            label={(line) => String(line + 1)}
            lineClass={numberClass(theirsSpans)}
            top={scroll.theirs}
            height={scroll.height}
            className="is-right"
          />
          <CodePane
            id="theirs"
            text={file.theirs}
            path={file.path}
            label="Theirs"
            decorate={decorateTheirs}
            hidden={noFolds}
            onView={onSideView}
            onScroll={onSideScroll}
            onExpand={noExpand}
          />
        </div>
      </div>
      <div className="dl-dialog-footer app-merge-footer">
        <button className="dl-btn" type="button" onClick={() => onAccept("ours")}>
          Accept Left
        </button>
        <button className="dl-btn" type="button" onClick={() => onAccept("theirs")}>
          Accept Right
        </button>
        <span className="dl-toolbar-spacer" />
        {onCancel && (
          <button className="dl-btn" type="button" onClick={requestCancel}>
            Cancel
          </button>
        )}
        <button className="dl-btn dl-btn-primary" type="button" onClick={apply}>
          Apply
        </button>
      </div>
      {confirm && (
        <Dialog label="Apply with unresolved changes" onClose={() => setConfirm(false)}>
          <div className="dl-dialog-title">Apply with unresolved changes?</div>
          <p className="dl-dialog-text">
            Not resolved yet: {unresolvedText(states)}. The result keeps the original text for them.
          </p>
          <div className="dl-dialog-footer">
            <button className="dl-btn" type="button" onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button className="dl-btn dl-btn-primary" type="button" onClick={apply}>
              Apply Anyway
            </button>
          </div>
        </Dialog>
      )}
      {discard && (
        <Dialog label="Discard merge changes" onClose={() => setDiscard(false)}>
          <div className="dl-dialog-title">Discard your changes?</div>
          <p className="dl-dialog-text">
            The changes you made to the result of {file.path} are lost. The file stays in conflict.
          </p>
          <div className="dl-dialog-footer">
            <button className="dl-btn" type="button" onClick={() => setDiscard(false)}>
              Keep Editing
            </button>
            <button className="dl-btn dl-btn-primary" type="button" onClick={onCancel}>
              Discard
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
