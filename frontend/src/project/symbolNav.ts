import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import type { Platform } from "../api";
import { hasModifier } from "../lib/platform";

export type IdentifierSpan = {
  symbol: string;
  start: number;
  end: number;
};

export type NavigatePoint = {
  x: number;
  y: number;
};

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

export function identifierAt(lineText: string, col: number): IdentifierSpan | null {
  if (col < 0 || col > lineText.length) return null;
  let index = col;
  if (index === lineText.length || !isIdentChar(lineText[index] ?? "")) {
    if (index > 0 && isIdentChar(lineText[index - 1] ?? "")) {
      index -= 1;
    } else {
      return null;
    }
  }
  let start = index;
  while (start > 0 && isIdentChar(lineText[start - 1] ?? "")) start -= 1;
  let end = index + 1;
  while (end < lineText.length && isIdentChar(lineText[end] ?? "")) end += 1;
  const symbol = lineText.slice(start, end);
  if (!symbol || /^[0-9]+$/.test(symbol)) return null;
  return { symbol, start, end };
}

const setHoverRange = StateEffect.define<{ from: number; to: number } | null>();
const symLinkMark = Decoration.mark({ class: "dl-sym-link" });

const hoverField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setHoverRange)) {
        if (!effect.value) return Decoration.none;
        return Decoration.set([symLinkMark.range(effect.value.from, effect.value.to)]);
      }
    }
    return transaction.docChanged ? Decoration.none : value;
  },
  provide: (self) => EditorView.decorations.from(self),
});

export function symbolNavigationExtension(
  platform: Platform,
  onNavigate: (symbol: string, line: number, point: NavigatePoint) => void,
): Extension {
  const resolveAtPoint = (view: EditorView, x: number, y: number) => {
    const pos = view.posAtCoords({ x, y });
    if (pos === null) return null;
    const line = view.state.doc.lineAt(pos);
    const span = identifierAt(line.text, pos - line.from);
    if (!span) return null;
    return {
      symbol: span.symbol,
      line: line.number,
      from: line.from + span.start,
      to: line.from + span.end,
    };
  };

  let lastRange: { from: number; to: number } | null = null;

  const setRange = (view: EditorView, next: { from: number; to: number } | null) => {
    if (
      lastRange === next ||
      (lastRange !== null &&
        next !== null &&
        lastRange.from === next.from &&
        lastRange.to === next.to)
    ) {
      return;
    }
    lastRange = next;
    view.dispatch({ effects: setHoverRange.of(next) });
  };

  return [
    hoverField,
    EditorView.domEventHandlers({
      mousemove(event, view) {
        if (!hasModifier(platform, event)) {
          setRange(view, null);
          return false;
        }
        const hit = resolveAtPoint(view, event.clientX, event.clientY);
        setRange(view, hit ? { from: hit.from, to: hit.to } : null);
        return false;
      },
      mouseleave(_event, view) {
        setRange(view, null);
        return false;
      },
      keyup(_event, view) {
        setRange(view, null);
        return false;
      },
      mousedown(event, view) {
        if (event.button !== 0 || !hasModifier(platform, event)) return false;
        const hit = resolveAtPoint(view, event.clientX, event.clientY);
        if (!hit) return false;
        event.preventDefault();
        onNavigate(hit.symbol, hit.line, { x: event.clientX, y: event.clientY });
        return true;
      },
    }),
  ];
}
