import {
  Compartment,
  EditorState,
  type Range as Ranged,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { Range } from "./geometry";
import { loadLanguage, syntaxClasses } from "./syntax";

export type Decorate = (doc: Text) => Ranged<Decoration>[];

type Props = {
  id: string;
  text: string;
  path: string;
  label: string;
  decorate: Decorate;
  hidden: Range[];
  onView: (id: string, view: EditorView | null) => void;
  onScroll: (id: string) => void;
  onExpand: (index: number) => void;
};

class FoldWidget extends WidgetType {
  constructor(
    readonly index: number,
    readonly count: number,
    readonly onExpand: (index: number) => void,
  ) {
    super();
  }

  eq(other: FoldWidget) {
    return (
      other.index === this.index && other.count === this.count && other.onExpand === this.onExpand
    );
  }

  toDOM() {
    const element = document.createElement("div");
    element.className = "dl-fold app-fold";
    element.title = `Show ${this.count} unchanged lines`;
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", `Show ${this.count} unchanged lines`);
    element.addEventListener("click", () => this.onExpand(this.index));
    return element;
  }

  get estimatedHeight() {
    return 20;
  }

  ignoreEvent() {
    return false;
  }
}

function foldRanges(
  doc: Text,
  hidden: Range[],
  onExpand: (index: number) => void,
): Ranged<Decoration>[] {
  return hidden.flatMap(([from, to], index) => {
    if (to <= from || to > doc.lines) return [];
    const widget = new FoldWidget(index, to - from, onExpand);
    return [
      Decoration.replace({ widget, block: true }).range(doc.line(from + 1).from, doc.line(to).to),
    ];
  });
}

const setFolds = StateEffect.define<{ hidden: Range[]; onExpand: (index: number) => void }>();

const foldField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setFolds)) {
        return Decoration.set(
          foldRanges(transaction.state.doc, effect.value.hidden, effect.value.onExpand),
          true,
        );
      }
    }
    return value;
  },
  provide: (self) => EditorView.decorations.from(self),
});

export function CodePane({
  id,
  text,
  path,
  label,
  decorate,
  hidden,
  onView,
  onScroll,
  onExpand,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const latest = useRef({ hidden, onExpand });
  latest.current = { hidden, onExpand };
  const applied = useRef<Range[] | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: "" }),
    });
    view.current = created;
    onView(id, created);
    const scroll = () => onScroll(id);
    created.scrollDOM.addEventListener("scroll", scroll, { passive: true });
    return () => {
      created.scrollDOM.removeEventListener("scroll", scroll);
      onView(id, null);
      created.destroy();
      view.current = null;
    };
  }, [id, onView, onScroll]);

  useEffect(() => {
    const current = view.current;
    if (!current) return;
    const compartment = language.current;
    const field = StateField.define<DecorationSet>({
      create: (state) => Decoration.set(decorate(state.doc), true),
      update: (value) => value,
      provide: (self) => EditorView.decorations.from(self),
    });
    const state = EditorState.create({
      doc: text,
      extensions: [
        EditorState.readOnly.of(true),
        EditorState.lineSeparator.of("\n"),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ "aria-label": label }),
        syntaxClasses,
        compartment.of([]),
        field,
        foldField,
      ],
    });
    const snapshot = current.scrollSnapshot();
    current.setState(state);
    applied.current = latest.current.hidden;
    current.dispatch({ effects: [snapshot, setFolds.of(latest.current)] });
    let cancelled = false;
    void loadLanguage(path).then((extension) => {
      if (!cancelled && extension && view.current === current) {
        current.dispatch({ effects: compartment.reconfigure(extension) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [text, path, label, decorate]);

  useEffect(() => {
    const current = view.current;
    if (!current || applied.current === hidden) return;
    applied.current = hidden;
    const snapshot = current.scrollSnapshot();
    current.dispatch({ effects: [setFolds.of({ hidden, onExpand }), snapshot] });
  }, [hidden, onExpand]);

  return <div ref={host} className={`app-cm is-${id}`} />;
}
