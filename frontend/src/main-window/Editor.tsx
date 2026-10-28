import { useEffect, useMemo, useState } from "react";
import type { ApiError, FileChange, FileDiff } from "../api";
import type { ChangeKind } from "../api/generated/ChangeKind";
import type { MarkdownView } from "../api/generated/MarkdownView";
import { fileIcon } from "../changes/fileIcons";
import { buildRows, selectionKey } from "../changes/rows";
import { DiffToolbar } from "../diff/DiffToolbar";
import { DiffViewer } from "../diff/DiffViewer";
import { UnifiedViewer } from "../diff/UnifiedViewer";
import { Icon } from "../lib/icon";
import { splitPath } from "../lib/paths";
import { usePlatform } from "../lib/platform";
import { canRender, isMarkdown, MarkdownDiff, markdownRows } from "../markdown-diff/MarkdownDiff";
import { MergeBanner } from "../merge/MergeBanner";
import { MergeHost } from "../merge/MergeHost";
import { useApp } from "../state/context";
import { defaultDiffSettings, diffMeasure, selectMark } from "../state/store";
import { NoticeBanner } from "./NoticeBanner";

type Source = {
  key: string;
  selection: string | null;
  current: string | null;
  files: string[];
  diff: FileDiff | null;
  diffError: ApiError | null;
  kind: ChangeKind | null;
  select: (path: string | null) => void;
  empty: { title: string; text: string } | null;
};

function useChangesSource(): Source {
  const changes = useApp((state) => state.changes);
  const selection = useApp((state) => state.repo?.lastSelection ?? null);
  const staged = useApp((state) => state.selectedStaged);
  const diff = useApp((state) => state.diff);
  const diffError = useApp((state) => state.diffError);
  const select = useApp((state) => state.select);
  const current = selectionKey(changes, selection, staged);
  const selected =
    selection !== null &&
    (changes === null || changes.some((c) => c.path === selection && c.kind !== "conflicted"));
  const conflicted = changes?.some((c) => c.path === selection && c.kind === "conflicted");
  const empty = conflicted
    ? {
        title: `${splitPath(selection ?? "").name} has conflicts`,
        text: "Resolve it in the terminal, then continue there.",
      }
    : changes && changes.length > 0
      ? { title: "Select a file to see its changes", text: "Pick a file in the list on the left." }
      : {
          title: "Nothing to compare",
          text: "Edit a file, or switch to Commit history or Review.",
        };
  return {
    key: "changes",
    selection,
    current,
    files: changes ? groupFiles(changes, current) : [],
    diff,
    diffError,
    kind: changes?.find((c) => c.path === selection)?.kind ?? null,
    select,
    empty: selected ? null : empty,
  };
}

function useLogSource(): Source {
  const commit = useApp((state) => state.commit);
  const logCommit = useApp((state) => state.logCommit);
  const selection = useApp((state) => state.logFile);
  const diff = useApp((state) => state.commitDiff);
  const diffError = useApp((state) => state.commitDiffError);
  const select = useApp((state) => state.selectLogFile);
  const empty =
    !logCommit || !commit
      ? { title: "Pick a commit", text: "Its files and diffs show here." }
      : commit.files.length === 0
        ? { title: "No changed files", text: "This commit changes no files." }
        : selection === null
          ? { title: "Select a file to see its changes", text: "Pick a file in the commit." }
          : null;
  return {
    key: commit?.id ?? "log",
    selection,
    current: selection,
    files: commit ? commit.files.map((file) => file.path) : [],
    diff,
    diffError,
    kind: commit?.files.find((file) => file.path === selection)?.kind ?? null,
    select,
    empty,
  };
}

export function Editor() {
  const platform = usePlatform();
  const tab = useApp((state) => state.repo?.lastTab ?? "changes");
  const changesSource = useChangesSource();
  const logSource = useLogSource();
  const source = tab === "log" ? logSource : changesSource;
  const { selection, files, diff, diffError, select } = source;
  const diffSettings = useApp((state) => state.settings?.diff ?? defaultDiffSettings);
  const setDiffSettings = useApp((state) => state.setDiffSettings);
  const [current, setCurrent] = useState(-1);
  const [views, setViews] = useState<Record<string, MarkdownView>>({});
  const resolving = useApp(
    (state) =>
      tab === "changes" &&
      state.merge?.operation === "merge" &&
      Boolean(state.merge.conflicts.some((conflict) => conflict.path === selection)),
  );

  const fileIndex = source.current ? files.indexOf(source.current) : -1;
  const shown = diff && diff.path === selection ? diff : null;
  const markdown = shown !== null && shown.content === "text" && isMarkdown(shown.path);
  const renderable = markdown && shown !== null && canRender(shown);
  const view = (selection ? views[selection] : undefined) ?? diffSettings.markdown;
  const rendered = renderable && view !== "raw";
  const leftText = shown?.left.text;
  const rightText = shown?.right.text;
  const rows = useMemo(
    () =>
      rendered && leftText !== undefined && rightText !== undefined
        ? markdownRows(leftText, rightText)
        : null,
    [rendered, leftText, rightText],
  );
  const differences = rows ? rows.changed.length : (shown?.blocks.length ?? 0);

  const shownPath = shown ? `${source.key}:${shown.path}` : undefined;
  const hasBlocks = differences > 0;
  const viewKey = shownPath && `${shownPath}:${rendered}`;
  useEffect(() => {
    setCurrent(viewKey && hasBlocks ? 0 : -1);
  }, [viewKey, hasBlocks]);

  useEffect(() => {
    if (shown && performance.getEntriesByName(selectMark).length > 0) {
      performance.measure(diffMeasure, selectMark);
      performance.clearMarks(selectMark);
    }
  }, [shown]);

  if (resolving && selection !== null) {
    return (
      <section className="dl-island app-editor" aria-label="Editor">
        <EditorTab path={selection} onClose={() => select(null)} />
        <MergeBanner />
        <NoticeBanner />
        <MergeHost file={selection} embedded onDone={(next) => select(next)} />
      </section>
    );
  }
  if (source.empty || selection === null) {
    const empty = source.empty ?? { title: "Nothing to compare", text: "" };
    return (
      <section className="dl-island app-editor" aria-label="Editor">
        <MergeBanner />
        <NoticeBanner />
        <div className="dl-empty app-fill">
          <span className="dl-empty-title">{empty.title}</span>
          <span>{empty.text}</span>
        </div>
      </section>
    );
  }

  const name = splitPath(selection).name;
  return (
    <section className="dl-island app-editor" aria-label="Editor">
      <EditorTab path={selection} onClose={() => select(null)} />
      <MergeBanner />
      <NoticeBanner />
      <DiffToolbar
        platform={platform}
        differences={differences}
        markdown={
          markdown
            ? {
                view,
                available: renderable,
                onChange: (next) => selection && setViews((all) => ({ ...all, [selection]: next })),
              }
            : undefined
        }
        separatorsOnly={Boolean(
          shown &&
            shown.blocks.length === 0 &&
            shown.left.exists &&
            shown.right.exists &&
            shown.left.crlf !== shown.right.crlf,
        )}
        current={current}
        fileIndex={fileIndex}
        fileCount={files.length}
        onDifference={setCurrent}
        settings={diffSettings}
        onFile={(step) => {
          const next = files[fileIndex + step];
          if (next) select(next);
        }}
        onSettings={(change) => void setDiffSettings(change)}
      />
      {shown && !diffError && (
        <SameNotice diff={shown} kind={source.kind} differences={differences} />
      )}
      {diffError ? (
        <div className="dl-empty app-fill" role="alert">
          <span className="dl-empty-title">The diff could not be read</span>
          <span>{diffError.message}</span>
        </div>
      ) : !shown ? (
        <div className="dl-empty app-fill">
          <span className="dl-empty-title">Preparing the diff</span>
          <span>{name} shows here as soon as it is ready.</span>
        </div>
      ) : rows ? (
        <MarkdownDiff
          key={`markdown-${shownPath}`}
          diff={shown}
          rows={rows}
          inline={view === "renderedInline"}
          collapse={diffSettings.collapseUnchanged}
          current={current}
          onCurrent={setCurrent}
        />
      ) : shown.content === "text" ? (
        diffSettings.viewer === "unified" ? (
          <UnifiedViewer
            key={`unified-${shownPath}`}
            diff={shown}
            current={current}
            collapse={diffSettings.collapseUnchanged}
            highlight={diffSettings.highlight}
            onCurrent={setCurrent}
          />
        ) : (
          <DiffViewer
            key={`split-${shownPath}`}
            diff={shown}
            current={current}
            collapse={diffSettings.collapseUnchanged}
            sync={diffSettings.syncScroll}
            highlight={diffSettings.highlight}
            onCurrent={setCurrent}
          />
        )
      ) : (
        <div className="dl-empty app-fill">
          <span className="dl-empty-title">No visual diff for this file type</span>
          <span>{noDiffReason(name, shown.content)}</span>
        </div>
      )}
    </section>
  );
}

export function sameText(diff: FileDiff, kind: ChangeKind | null): string | null {
  if (diff.content !== "text" || diff.blocks.length > 0) return null;
  const { left, right } = diff;
  if (!left.exists || !right.exists) return null;
  const from =
    diff.oldPath && diff.oldPath !== diff.path
      ? `${kind === "copied" ? "Copied" : "Moved"} from ${diff.oldPath}. `
      : "";
  if (left.text !== right.text)
    return `${from}Only whitespace differs, and the diff settings ignore it.`;
  if (left.encoding !== right.encoding)
    return `${from}Only the encoding changed, from ${left.encoding} to ${right.encoding}.`;
  if (left.crlf !== right.crlf)
    return `${from}Only the line endings changed, from ${lineEnding(left.crlf)} to ${lineEnding(right.crlf)}.`;
  return `${from}The contents are identical.`;
}

function lineEnding(crlf: boolean): string {
  return crlf ? "CRLF" : "LF";
}

function SameNotice({
  diff,
  kind,
  differences,
}: {
  diff: FileDiff;
  kind: ChangeKind | null;
  differences: number;
}) {
  const text = differences === 0 ? sameText(diff, kind) : null;
  if (!text) return null;
  return (
    <div className="app-editor-notice">
      <div className="dl-banner is-info" role="status">
        <Icon name="status-info" />
        <span className="dl-banner-text">{text}</span>
      </div>
    </div>
  );
}

function EditorTab({ path, onClose }: { path: string; onClose: () => void }) {
  return (
    <header className="dl-island-header app-editor-tabs">
      <span className="dl-tab is-selected">
        <span className={`dl-i ${fileIcon(path)}`} aria-hidden="true" />
        <span>{splitPath(path).name}</span>
        <button
          className="dl-tbtn app-tab-close"
          type="button"
          aria-label="Close tab"
          title="Close tab"
          onClick={onClose}
        >
          <Icon name="general-close" />
        </button>
      </span>
    </header>
  );
}

function groupFiles(changes: FileChange[], selection: string | null): string[] {
  const rows = buildRows(changes, { collapsed: new Set() });
  const group = new Map<string, string>();
  let current = "";
  for (const row of rows) {
    if (row.type === "group") current = row.id;
    else group.set(row.id, current);
  }
  const wanted = selection ? group.get(selection) : undefined;
  return rows.flatMap((row) =>
    row.type === "file" && group.get(row.id) === wanted ? [row.id] : [],
  );
}

function noDiffReason(name: string, content: string): string {
  if (content === "image") return `${name} is an image. Diffloupe compares text files only.`;
  if (content === "tooLarge")
    return `${name} is larger than 20 MB. Diffloupe compares smaller text files only.`;
  return `${name} is a binary file. Diffloupe compares text files only.`;
}
