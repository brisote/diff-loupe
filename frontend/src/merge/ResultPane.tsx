import {
  defaultKeymap,
  history,
  historyKeymap,
  invertedEffects,
  isolateHistory,
} from "@codemirror/commands";
import {
  Annotation,
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { Decorate } from "../diff/CodePane";
import { loadLanguage, syntaxClasses } from "../diff/syntax";
import { type ChunkState, mapStates } from "./model";

export const ownEdit = Annotation.define<boolean>();

const setChunks = StateEffect.define<ChunkState[]>();

const chunkField = StateField.define<ChunkState[]>({
  create: () => [],
  update: (value, transaction) => {
    for (const effect of transaction.effects) if (effect.is(setChunks)) return effect.value;
    if (!transaction.docChanged) return value;
    return mapStates(value, transaction.changes, !transaction.annotation(ownEdit));
  },
});

const undoChunks = invertedEffects.of((transaction) => {
  const before = transaction.startState.field(chunkField, false);
  return before && before !== transaction.state.field(chunkField, false)
    ? [setChunks.of(before)]
    : [];
});

export function chunks(view: EditorView): ChunkState[] {
  return view.state.field(chunkField);
}

export function chunkUpdate(states: ChunkState[]): TransactionSpec {
  return {
    effects: setChunks.of(states),
    annotations: [ownEdit.of(true), isolateHistory.of("full")],
  };
}

const setDecorations = StateEffect.define<Decorate>();

const decorationField = StateField.define<{ decorate: Decorate; set: DecorationSet }>({
  create: () => ({ decorate: () => [], set: Decoration.none }),
  update: (value, transaction) => {
    let decorate = value.decorate;
    for (const effect of transaction.effects)
      if (effect.is(setDecorations)) decorate = effect.value;
    if (decorate === value.decorate && !transaction.docChanged) return value;
    return { decorate, set: Decoration.set(decorate(transaction.state.doc), true) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.set),
});

type Props = {
  text: string;
  initial: ChunkState[];
  path: string;
  decorate: Decorate;
  onView: (view: EditorView | null) => void;
  onScroll: () => void;
  onEdit: (view: EditorView) => void;
};

export function ResultPane({ text, initial, path, decorate, onView, onScroll, onEdit }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onEdit, onScroll, decorate, initial });
  latest.current = { onEdit, onScroll, decorate, initial };

  useEffect(() => {
    if (!host.current) return;
    const language = new Compartment();
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          history(),
          chunkField.init(() => latest.current.initial),
          undoChunks,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorState.lineSeparator.of("\n"),
          EditorView.contentAttributes.of({ "aria-label": "Result" }),
          syntaxClasses,
          language.of([]),
          decorationField,
          EditorView.updateListener.of((update) => {
            const moved =
              update.startState.field(chunkField, false) !== update.state.field(chunkField, false);
            if (update.docChanged || moved) latest.current.onEdit(update.view);
          }),
        ],
      }),
    });
    created.dispatch({ effects: setDecorations.of(latest.current.decorate) });
    view.current = created;
    onView(created);
    const scroll = () => latest.current.onScroll();
    created.scrollDOM.addEventListener("scroll", scroll, { passive: true });
    let cancelled = false;
    void loadLanguage(path).then((extension) => {
      if (!cancelled && extension) created.dispatch({ effects: language.reconfigure(extension) });
    });
    return () => {
      cancelled = true;
      created.scrollDOM.removeEventListener("scroll", scroll);
      onView(null);
      created.destroy();
      view.current = null;
    };
  }, [text, path, onView]);

  useEffect(() => {
    view.current?.dispatch({ effects: setDecorations.of(decorate) });
  }, [decorate]);

  return <div ref={host} className="app-cm is-result" />;
}
