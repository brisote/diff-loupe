import {
  HighlightStyle,
  type LanguageSupport,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";
import { fileExtension } from "../lib/fileTypes";

export const syntaxClasses = syntaxHighlighting(
  HighlightStyle.define([
    {
      tag: [
        tags.keyword,
        tags.modifier,
        tags.controlKeyword,
        tags.definitionKeyword,
        tags.operatorKeyword,
        tags.moduleKeyword,
      ],
      class: "syn-kw",
    },
    {
      tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character, tags.escape],
      class: "syn-str",
    },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], class: "syn-num" },
    { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], class: "syn-com" },
    {
      tag: [
        tags.function(tags.variableName),
        tags.function(tags.definition(tags.variableName)),
        tags.function(tags.propertyName),
      ],
      class: "syn-fn",
    },
    { tag: [tags.propertyName, tags.attributeName], class: "syn-fld" },
    {
      tag: [tags.meta, tags.annotation, tags.processingInstruction, tags.heading],
      class: "syn-meta",
    },
  ]),
);

type Loader = () => Promise<Extension>;

const support = (load: () => Promise<LanguageSupport>): Loader => load;
const legacy =
  (load: () => Promise<Parameters<typeof StreamLanguage.define>[0]>): Loader =>
  async () =>
    StreamLanguage.define(await load());

const loaders: Record<string, Loader> = {
  ts: support(async () =>
    (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
  ),
  tsx: support(async () =>
    (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true }),
  ),
  js: support(async () => (await import("@codemirror/lang-javascript")).javascript()),
  jsx: support(async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true })),
  json: support(async () => (await import("@codemirror/lang-json")).json()),
  css: support(async () => (await import("@codemirror/lang-css")).css()),
  html: support(async () => (await import("@codemirror/lang-html")).html()),
  md: support(async () => (await import("@codemirror/lang-markdown")).markdown()),
  py: support(async () => (await import("@codemirror/lang-python")).python()),
  rs: support(async () => (await import("@codemirror/lang-rust")).rust()),
  java: support(async () => (await import("@codemirror/lang-java")).java()),
  sql: support(async () => (await import("@codemirror/lang-sql")).sql()),
  yaml: support(async () => (await import("@codemirror/lang-yaml")).yaml()),
  kt: legacy(async () => (await import("@codemirror/legacy-modes/mode/clike")).kotlin),
  go: legacy(async () => (await import("@codemirror/legacy-modes/mode/go")).go),
  rb: legacy(async () => (await import("@codemirror/legacy-modes/mode/ruby")).ruby),
  sh: legacy(async () => (await import("@codemirror/legacy-modes/mode/shell")).shell),
  toml: legacy(async () => (await import("@codemirror/legacy-modes/mode/toml")).toml),
};

const aliases: Record<string, string> = {
  mts: "ts",
  cts: "ts",
  mjs: "js",
  cjs: "js",
  htm: "html",
  markdown: "md",
  yml: "yaml",
  kts: "kt",
  bash: "sh",
  zsh: "sh",
  scss: "css",
  less: "css",
};

export function languageKey(path: string): string | null {
  const extension = fileExtension(path);
  if (!extension) return null;
  const key = aliases[extension] ?? extension;
  return key in loaders ? key : null;
}

export async function loadLanguage(path: string): Promise<Extension | null> {
  const key = languageKey(path);
  const loader = key ? loaders[key] : undefined;
  return loader ? loader() : null;
}
