import type { Extension, Text } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SymbolMatch } from "../api";
import { fileIcon } from "../changes/fileIcons";
import { CodePane, type Decorate } from "../diff/CodePane";
import { DiffSearchBar } from "../diff/DiffSearchBar";
import { layout, lineHeight } from "../diff/geometry";
import { LineNumbers } from "../diff/LineNumbers";
import { findMatches, searchDecorations } from "../diff/search";
import { Icon } from "../lib/icon";
import { splitPath } from "../lib/paths";
import { usePlatform } from "../lib/platform";
import { isMarkdown } from "../markdown-diff/MarkdownDiff";
import { MarkdownDocument } from "../markdown-diff/MarkdownDocument";
import { useApp } from "../state/context";
import { formatStructuredFile, isFormattableFile } from "./format";
import { SymbolPopup } from "./SymbolPopup";
import { type NavigatePoint, symbolNavigationExtension } from "./symbolNav";

type ViewMode = "rendered" | "pretty" | "raw";

type UsagesState = {
  symbol: string;
  matches: SymbolMatch[];
  truncated: boolean;
  point: NavigatePoint;
};

const targetLineDeco = Decoration.line({ class: "is-target-line" });
const formatAndRenderLimit = 512 * 1024;

export function FileViewer({ extraExtensions }: { extraExtensions?: Extension[] } = {}) {
  const platform = usePlatform();
  const backend = useApp((state) => state.backend);
  const repoPath = useApp((state) => state.repo?.path ?? null);
  const selected = useApp((state) => state.projectSelectedFile);
  const file = useApp((state) => state.projectFile);
  const error = useApp((state) => state.projectFileError);
  const targetLine = useApp((state) => state.projectTargetLine);
  const expandProjectParents = useApp((state) => state.expandProjectParents);
  const selectProjectFile = useApp((state) => state.selectProjectFile);
  const searchOpen = useApp((state) => state.searchOpen);
  const searchQuery = useApp((state) => state.searchQuery);
  const searchCase = useApp((state) => state.searchCase);
  const searchMatch = useApp((state) => state.searchMatch);
  const setSearchQuery = useApp((state) => state.setSearchQuery);
  const toggleSearchCase = useApp((state) => state.toggleSearchCase);
  const closeSearch = useApp((state) => state.closeSearch);
  const setSearchMatch = useApp((state) => state.setSearchMatch);

  const [modes, setModes] = useState<Record<string, ViewMode>>({});
  const [searchIndex, setSearchIndex] = useState(0);
  const [scroll, setScroll] = useState({ top: 0, height: 0 });
  const [usages, setUsages] = useState<UsagesState | null>(null);
  const [navNotice, setNavNotice] = useState<string | null>(null);
  const view = useRef<EditorView | null>(null);
  const frame = useRef(0);
  const searchSeq = useRef(0);

  const loaded = file && file.path === selected ? file : null;
  const markdown = loaded !== null && loaded.content === "text" && isMarkdown(loaded.path);
  const formattable =
    loaded !== null && loaded.content === "text" && isFormattableFile(loaded.path);
  const tooLargeToEnhance =
    loaded !== null && loaded.content === "text" && loaded.text.length > formatAndRenderLimit;
  const defaultMode: ViewMode = tooLargeToEnhance
    ? "raw"
    : markdown
      ? "rendered"
      : formattable
        ? "pretty"
        : "raw";
  const mode = tooLargeToEnhance
    ? "raw"
    : ((selected ? modes[selected] : undefined) ?? defaultMode);

  useEffect(() => {
    if (targetLine && selected === targetLine.file && (markdown || formattable)) {
      setModes((all) =>
        all[targetLine.file] === "raw" ? all : { ...all, [targetLine.file]: "raw" },
      );
    }
  }, [targetLine, selected, markdown, formattable]);

  const formatted = useMemo(() => {
    if (loaded?.content !== "text" || !formattable || mode !== "pretty") return null;
    return formatStructuredFile(loaded.path, loaded.text);
  }, [loaded, formattable, mode]);

  const shownText = useMemo(() => {
    if (loaded?.content !== "text") return "";
    if (formatted?.ok) return formatted.text;
    return loaded.text;
  }, [loaded, formatted]);

  const formatWarning = formatted && !formatted.ok ? formatted.error : null;
  const isRenderedMarkdown = markdown && mode === "rendered";

  const lineCount = useMemo(() => (shownText ? shownText.split("\n").length : 1), [shownText]);
  const map = useMemo(() => layout(lineCount, []), [lineCount]);

  const matches = useMemo(
    () =>
      searchOpen && searchQuery && loaded?.content === "text" && !isRenderedMarkdown
        ? findMatches(shownText, searchQuery, searchCase, "unified")
        : [],
    [searchOpen, searchQuery, searchCase, loaded, isRenderedMarkdown, shownText],
  );

  const resetKey = `${selected ?? ""}:${mode}:${searchCase}:${searchQuery}`;
  useEffect(() => {
    if (resetKey !== undefined) setSearchIndex(0);
  }, [resetKey]);

  const activeIndex = matches.length > 0 ? Math.min(searchIndex, matches.length - 1) : 0;
  const activeMatch = matches[activeIndex] ?? null;

  useEffect(() => {
    if (!searchOpen || !searchQuery) {
      setSearchMatch({ current: 0, total: 0 });
      return;
    }
    setSearchMatch({
      current: matches.length > 0 ? activeIndex + 1 : 0,
      total: matches.length,
    });
  }, [searchOpen, searchQuery, activeIndex, matches.length, setSearchMatch]);

  const searchDecos = useMemo(
    () => searchDecorations(matches, activeMatch),
    [matches, activeMatch],
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
  const noopExpand = useCallback(() => undefined, []);

  useEffect(() => {
    if (!activeMatch || !view.current) return;
    const editor = view.current;
    const pos = Math.min(activeMatch.from, editor.state.doc.length);
    editor.dispatch({
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
  }, [activeMatch]);

  useEffect(() => {
    if (!targetLine || !loaded || targetLine.file !== loaded.path || isRenderedMarkdown) return;
    const frameId = requestAnimationFrame(() => {
      const editor = view.current;
      if (!editor) return;
      const lineNum = Math.max(1, Math.min(targetLine.line, editor.state.doc.lines));
      const lineInfo = editor.state.doc.line(lineNum);
      editor.dispatch({
        effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
      });
      measure();
    });
    return () => cancelAnimationFrame(frameId);
  }, [targetLine, loaded, isRenderedMarkdown, measure]);

  const highlightLine =
    targetLine && loaded && targetLine.file === loaded.path && !isRenderedMarkdown
      ? targetLine.line
      : null;

  const decorate = useCallback<Decorate>(
    (doc: Text) => {
      if (!highlightLine || highlightLine < 1 || highlightLine > doc.lines) return [];
      return [targetLineDeco.range(doc.line(highlightLine).from)];
    },
    [highlightLine],
  );

  const emptyHidden = useMemo<[]>(() => [], []);

  const navResetKey = `${repoPath ?? ""}:${selected ?? ""}`;
  useEffect(() => {
    if (navResetKey !== undefined) {
      setUsages(null);
      setNavNotice(null);
    }
  }, [navResetKey]);

  const jumpToMatch = useCallback(
    (match: SymbolMatch) => {
      setUsages(null);
      setNavNotice(null);
      void expandProjectParents(match.file);
      void selectProjectFile(match.file, match.line);
    },
    [expandProjectParents, selectProjectFile],
  );

  const handleSymbolNavigate = useCallback(
    (symbol: string, line: number, point: NavigatePoint) => {
      if (!repoPath || !selected) return;
      const req = ++searchSeq.current;
      const activeRepo = repoPath;
      setNavNotice(null);
      void backend
        .call("search_symbol", {
          path: activeRepo,
          symbol,
          currentFile: selected,
          currentLine: mode === "pretty" ? undefined : line,
        })
        .then((result) => {
          if (req !== searchSeq.current) return;
          if (result.matches.length === 0) {
            setUsages(null);
            setNavNotice(`No other usages found for "${symbol}".`);
          } else if (result.matches.length === 1 && result.matches[0]) {
            jumpToMatch(result.matches[0]);
          } else {
            setUsages({
              symbol: result.symbol,
              matches: result.matches,
              truncated: result.truncated,
              point,
            });
          }
        })
        .catch(() => undefined);
    },
    [backend, repoPath, selected, mode, jumpToMatch],
  );

  const paneExtensions = useMemo<Extension[]>(
    () => [symbolNavigationExtension(platform, handleSymbolNavigate), ...(extraExtensions ?? [])],
    [platform, handleSymbolNavigate, extraExtensions],
  );

  if (!selected) {
    return (
      <section className="dl-island app-editor" aria-label="File viewer">
        <div className="dl-empty app-fill">
          <span className="dl-empty-title">Select a file to view</span>
          <span>Pick a file in the project tree on the left.</span>
        </div>
      </section>
    );
  }

  const { name, folder } = splitPath(selected);

  return (
    <section className="dl-island app-editor" aria-label="File viewer">
      <header className="dl-file-head">
        <span className={`dl-i ${fileIcon(selected)}`} aria-hidden="true" />
        <span className="dl-file-name">{name}</span>
        {folder && <span className="dl-file-dir">{folder}</span>}
        <span className="dl-toolbar-spacer" />
        {markdown && (
          <fieldset className="dl-seg app-seg" aria-label="Markdown view">
            <button
              className={`dl-tbtn ${mode === "rendered" ? "is-selected" : ""}`}
              type="button"
              style={{ width: "auto", padding: "0 8px" }}
              disabled={tooLargeToEnhance}
              title={tooLargeToEnhance ? "Files larger than 512 KB open in raw view" : undefined}
              aria-pressed={mode === "rendered"}
              onClick={() => setModes((all) => ({ ...all, [selected]: "rendered" }))}
            >
              Rendered
            </button>
            <button
              className={`dl-tbtn ${mode === "raw" ? "is-selected" : ""}`}
              type="button"
              style={{ width: "auto", padding: "0 8px" }}
              aria-pressed={mode === "raw"}
              onClick={() => setModes((all) => ({ ...all, [selected]: "raw" }))}
            >
              Raw
            </button>
          </fieldset>
        )}
        {formattable && (
          <fieldset className="dl-seg app-seg" aria-label="Format view">
            <button
              className={`dl-tbtn ${mode === "pretty" ? "is-selected" : ""}`}
              type="button"
              style={{ width: "auto", padding: "0 8px" }}
              disabled={tooLargeToEnhance}
              title={tooLargeToEnhance ? "Files larger than 512 KB open in raw view" : undefined}
              aria-pressed={mode === "pretty"}
              onClick={() => setModes((all) => ({ ...all, [selected]: "pretty" }))}
            >
              Pretty
            </button>
            <button
              className={`dl-tbtn ${mode === "raw" ? "is-selected" : ""}`}
              type="button"
              style={{ width: "auto", padding: "0 8px" }}
              aria-pressed={mode === "raw"}
              onClick={() => setModes((all) => ({ ...all, [selected]: "raw" }))}
            >
              Raw
            </button>
          </fieldset>
        )}
      </header>
      {tooLargeToEnhance && (markdown || formattable) && (
        <div className="app-editor-notice">
          <div className="dl-banner is-info" role="status">
            <Icon name="status-info" />
            <span className="dl-banner-text">
              Showing raw text because this file is larger than 512 KB.
            </span>
          </div>
        </div>
      )}
      {formatWarning && (
        <div className="app-editor-notice">
          <div className="dl-banner is-info" role="status">
            <Icon name="status-info" />
            <span className="dl-banner-text">
              Showing raw text because this file could not be formatted: {formatWarning}
            </span>
          </div>
        </div>
      )}
      {navNotice && (
        <div className="app-editor-notice">
          <div className="dl-banner is-info" role="status">
            <Icon name="status-info" />
            <span className="dl-banner-text">{navNotice}</span>
          </div>
        </div>
      )}
      {error ? (
        <div className="dl-empty app-fill" role="alert">
          <span className="dl-empty-title">The file could not be read</span>
          <span>{error.message}</span>
        </div>
      ) : !loaded ? (
        <div className="dl-empty app-fill">
          <span className="dl-empty-title">Loading file</span>
          <span>{name} shows here as soon as it is ready.</span>
        </div>
      ) : loaded.content !== "text" ? (
        <div className="dl-empty app-fill">
          <span className="dl-empty-title">Cannot preview this file</span>
          <span>{unreadableReason(name, loaded.content)}</span>
        </div>
      ) : isRenderedMarkdown ? (
        <div className="dl-file-body">
          <div className="dl-file-md">
            <MarkdownDocument markdown={loaded.text} />
          </div>
        </div>
      ) : (
        <div className="app-viewer-host">
          {searchOpen && (
            <DiffSearchBar
              query={searchQuery}
              match={searchMatch}
              caseSensitive={searchCase}
              onQueryChange={setSearchQuery}
              onPrevious={() =>
                setSearchIndex(
                  matches.length > 0 ? (activeIndex - 1 + matches.length) % matches.length : 0,
                )
              }
              onNext={() =>
                setSearchIndex(matches.length > 0 ? (activeIndex + 1) % matches.length : 0)
              }
              onToggleCase={toggleSearchCase}
              onClose={closeSearch}
            />
          )}
          <div className="app-file-grid">
            <LineNumbers
              map={map}
              label={(line) => String(line + 1)}
              lineClass={(line) => (highlightLine === line + 1 ? " is-target-line" : "")}
              top={scroll.top}
              height={scroll.height || lineCount * lineHeight}
              className="is-project"
            />
            <div className="app-diff-right">
              <CodePane
                id="project"
                text={shownText}
                path={loaded.path}
                label={name}
                editable={false}
                decorate={decorate}
                searchDecorations={searchDecos}
                hidden={emptyHidden}
                extraExtensions={paneExtensions}
                onView={onView}
                onScroll={onScroll}
                onExpand={noopExpand}
              />
            </div>
          </div>
          {usages && (
            <SymbolPopup
              symbol={usages.symbol}
              matches={usages.matches}
              truncated={usages.truncated}
              point={usages.point}
              onSelect={jumpToMatch}
              onClose={() => setUsages(null)}
            />
          )}
        </div>
      )}
    </section>
  );
}

function unreadableReason(name: string, content: string): string {
  if (content === "image") return `${name} is an image. The file browser previews text files only.`;
  if (content === "tooLarge")
    return `${name} is larger than 20 MB. The file browser previews smaller text files only.`;
  return `${name} is a binary file. The file browser previews text files only.`;
}
