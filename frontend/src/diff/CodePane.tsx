import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  Compartment,
  EditorState,
  type Range as Ranged,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { Range } from "./geometry";
import { loadLanguage, syntaxClasses } from "./syntax";

export type Decorate = (doc: Text) => Ranged<Decoration>[];

type Props = {
  id: string;
  text: string;
  path: string;
  label: string;
  editable?: boolean;
  onChange?: (text: string) => void;
  onSave?: () => void;
  onBlur?: () => void;
  decorate: Decorate;
  searchDecorations?: Ranged<Decoration>[];
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
const setSearchDecorations = StateEffect.define<Ranged<Decoration>[]>();
const setDecorations = StateEffect.define<Decorate>();

const decorationField = StateField.define<{ decorate: Decorate; set: DecorationSet }>({
  create: () => ({ decorate: () => [], set: Decoration.none }),
  update: (value, transaction) => {
    let decorate = value.decorate;
    for (const effect of transaction.effects) {
      if (effect.is(setDecorations)) decorate = effect.value;
    }
    if (decorate === value.decorate && !transaction.docChanged) return value;
    return { decorate, set: Decoration.set(decorate(transaction.state.doc), true) };
  },
  provide: (self) => EditorView.decorations.from(self, (value) => value.set),
});

const searchField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setSearchDecorations)) {
        return Decoration.set(effect.value, true);
      }
    }
    return value;
  },
  provide: (self) => EditorView.decorations.from(self),
});

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
  editable,
  onChange,
  onSave,
  onBlur,
  decorate,
  searchDecorations,
  hidden,
  onView,
  onScroll,
  onExpand,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const latest = useRef({ hidden, onExpand, searchDecorations, onChange, onSave, onBlur });
  latest.current = { hidden, onExpand, searchDecorations, onChange, onSave, onBlur };
  const applied = useRef<Range[] | null>(null);
  const initialized = useRef(false);
  const lastPath = useRef<string | null>(null);
  const lastEditable = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (!host.current) return;
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: "" }),
    });
    view.current = created;
    initialized.current = false;
    onView(id, created);
    const scroll = () => onScroll(id);
    created.scrollDOM.addEventListener("scroll", scroll, { passive: true });
    return () => {
      created.scrollDOM.removeEventListener("scroll", scroll);
      onView(id, null);
      created.destroy();
      view.current = null;
      initialized.current = false;
    };
  }, [id, onView, onScroll]);

  useEffect(() => {
    const current = view.current;
    if (!current) return;
    const compartment = language.current;

    const pathChanged = lastPath.current !== path;
    const editableChanged = lastEditable.current !== editable;
    lastPath.current = path;
    lastEditable.current = editable;

    if (!initialized.current || pathChanged || editableChanged) {
      initialized.current = true;
      const extensions = [
        EditorState.lineSeparator.of("\n"),
        EditorView.contentAttributes.of({ "aria-label": label }),
        syntaxClasses,
        compartment.of([]),
        decorationField,
        searchField,
        foldField,
      ];
      if (editable) {
        extensions.push(
          EditorState.readOnly.of(false),
          EditorView.editable.of(true),
          history(),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                latest.current.onSave?.();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              latest.current.onChange?.(update.state.doc.toString());
            }
          }),
          EditorView.domEventHandlers({
            blur: () => {
              latest.current.onBlur?.();
            },
          }),
        );
      } else {
        extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
      }

      const state = EditorState.create({
        doc: text,
        extensions,
      });
      const snapshot = current.scrollSnapshot();
      current.setState(state);
      applied.current = latest.current.hidden;
      const initialEffects: StateEffect<unknown>[] = [
        snapshot,
        setDecorations.of(decorate),
        setFolds.of(latest.current),
      ];
      if (latest.current.searchDecorations && latest.current.searchDecorations.length > 0) {
        initialEffects.push(setSearchDecorations.of(latest.current.searchDecorations));
      }
      current.dispatch({ effects: initialEffects });
      let cancelled = false;
      void loadLanguage(path).then((extension) => {
        if (!cancelled && extension && view.current === current) {
          current.dispatch({ effects: compartment.reconfigure(extension) });
        }
      });
      return () => {
        cancelled = true;
      };
    }

    if (current.state.doc.toString() !== text) {
      const snapshot = current.scrollSnapshot();
      current.dispatch({
        changes: { from: 0, to: current.state.doc.length, insert: text },
        effects: [snapshot, setDecorations.of(decorate)],
      });
    } else {
      current.dispatch({ effects: setDecorations.of(decorate) });
    }
  }, [text, path, label, editable, decorate]);

  useEffect(() => {
    const current = view.current;
    if (!current || applied.current === hidden) return;
    applied.current = hidden;
    const snapshot = current.scrollSnapshot();
    current.dispatch({ effects: [setFolds.of({ hidden, onExpand }), snapshot] });
  }, [hidden, onExpand]);

  useEffect(() => {
    const current = view.current;
    if (!current) return;
    current.dispatch({ effects: setSearchDecorations.of(searchDecorations ?? []) });
  }, [searchDecorations]);

  return <div ref={host} className={`app-cm is-${id}`} />;
}
