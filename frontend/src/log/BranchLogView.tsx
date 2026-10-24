import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CommitDetails, LogEntry } from "../api";
import { fileIcon } from "../changes/fileIcons";
import { fileCount, statusClass } from "../changes/rows";
import { fullDate, relativeDate } from "../lib/dates";
import { Icon } from "../lib/icon";
import { splitPath } from "../lib/paths";
import { useApp } from "../state/context";

const rowHeight = 24;

export function commitCount(count: number): string {
  return count === 1 ? "1 commit" : `${count} commits`;
}

export function matches(entry: LogEntry, filter: string, target: string | null): boolean {
  const wanted = filter.trim().toLowerCase();
  if (!wanted) return true;
  const text = entry.merged
    ? `${mergedLabel(target)} ${entry.subject}`
    : `${entry.short} ${entry.subject} ${entry.author}`;
  return text.toLowerCase().includes(wanted) || entry.id.startsWith(wanted);
}

function mergedLabel(target: string | null): string {
  return `Merged ${target ?? "the target branch"}`;
}

export function BranchLogView() {
  const log = useApp((state) => state.log);
  const logError = useApp((state) => state.logError);
  const target = useApp((state) => state.log?.target ?? state.repo?.target ?? null);
  const loadLog = useApp((state) => state.loadLog);
  const [filter, setFilter] = useState("");
  const files = useRef<HTMLDivElement>(null);
  const entries = useMemo(
    () => (log ? log.entries.filter((entry) => matches(entry, filter, target)) : []),
    [log, filter, target],
  );

  return (
    <>
      <div
        className="dl-toolbar app-changes-toolbar"
        role="toolbar"
        aria-label="Branch log actions"
      >
        <button
          className="dl-tbtn"
          type="button"
          aria-label="Refresh"
          title="Refresh"
          onClick={() => void loadLog()}
        >
          <Icon name="general-refresh" />
        </button>
        <label className="dl-field app-log-filter" htmlFor="log-filter">
          <Icon name="general-search" />
          <input
            id="log-filter"
            placeholder="Filter commits"
            aria-label="Filter commits"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      </div>
      {logError ? (
        <div className="dl-empty app-fill" role="alert">
          <span className="dl-empty-title">The branch history could not be read</span>
          <span>{logError.message}</span>
        </div>
      ) : !log ? (
        <div className="dl-empty app-fill">
          <span className="dl-empty-title">Loading the branch history</span>
          <span>The commits show here as soon as they are read.</span>
        </div>
      ) : log.entries.length === 0 ? (
        <div className="dl-empty app-fill">
          <span className="dl-empty-title">No commits on this branch yet</span>
          <span>
            {log.target
              ? `Every commit on this branch is also on ${log.target}.`
              : "The branch has no commits."}
          </span>
        </div>
      ) : (
        <>
          <div className="dl-row dl-row-group app-log-head">
            <span>Branch commit history</span>
            <span className="dl-row-count">
              {log.truncated
                ? `Latest ${commitCount(log.entries.length)}`
                : commitCount(log.entries.filter((entry) => !entry.merged).length)}
            </span>
          </div>
          <CommitList entries={entries} target={target} files={files} />
          <div className="app-log-split" />
          <CommitPane files={files} target={target} />
        </>
      )}
    </>
  );
}

type ListProps = {
  entries: LogEntry[];
  target: string | null;
  files: RefObject<HTMLDivElement | null>;
};

function CommitList({ entries, target, files }: ListProps) {
  const selected = useApp((state) => state.logCommit);
  const selectCommit = useApp((state) => state.selectCommit);
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    initialRect: { width: 400, height: 300 },
  });
  const index = entries.findIndex((entry) => entry.id === selected);
  const items = virtualizer.getVirtualItems();
  const active = items.some((item) => item.index === index) ? `commit-row-${index}` : undefined;

  const keepFocus = (event: MouseEvent) => {
    event.preventDefault();
    scroller.current?.focus();
  };
  const move = (step: 1 | -1) => {
    const next = index < 0 ? (step === 1 ? 0 : entries.length - 1) : index + step;
    const entry = entries[next];
    if (!entry) return;
    selectCommit(entry.id);
    virtualizer.scrollToIndex(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      files.current?.focus();
    }
  };

  if (entries.length === 0) {
    return (
      <div className="dl-empty app-log-commits">
        <span className="dl-empty-title">No matching commits</span>
        <span>Change the filter to see more.</span>
      </div>
    );
  }
  return (
    <div
      ref={scroller}
      className="dl-list app-log-commits"
      role="listbox"
      aria-label="Branch commits"
      tabIndex={0}
      aria-activedescendant={active}
      onKeyDown={onKeyDown}
    >
      <div className="app-virtual" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const entry = entries[item.index];
          if (!entry) return null;
          const isSelected = entry.id === selected;
          const label = entry.merged ? mergedLabel(target) : entry.subject;
          return (
            <div
              key={entry.id}
              id={`commit-row-${item.index}`}
              className={`dl-row dl-commit app-virtual-row ${entry.merged ? "is-merge" : ""} ${isSelected ? "is-selected" : ""}`}
              role="option"
              aria-selected={isSelected}
              aria-label={label}
              title={entry.merged ? entry.subject : undefined}
              style={{ transform: `translateY(${item.start}px)` }}
              tabIndex={-1}
              onMouseDown={keepFocus}
              onClick={() => selectCommit(entry.id)}
              onKeyDown={(event) => onActivateKey(event, () => selectCommit(entry.id))}
            >
              {!entry.merged && <span className="dl-commit-hash">{entry.short}</span>}
              <span className="dl-commit-subject">{label}</span>
              {!entry.merged && <span className="dl-commit-meta">{fileCount(entry.files)}</span>}
              {!entry.merged && <span className="dl-commit-meta">{entry.author}</span>}
              <span className="dl-commit-meta">{relativeDate(entry.time)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CommitPane({
  files,
  target,
}: {
  files: RefObject<HTMLDivElement | null>;
  target: string | null;
}) {
  const commit = useApp((state) => state.commit);
  const commitError = useApp((state) => state.commitError);
  const selected = useApp((state) => state.logCommit);
  if (!selected) {
    return (
      <div className="dl-empty app-log-details">
        <span className="dl-empty-title">Pick a commit</span>
        <span>Its message and changed files show here.</span>
      </div>
    );
  }
  if (commitError) {
    return (
      <div className="dl-empty app-log-details" role="alert">
        <span className="dl-empty-title">The commit could not be read</span>
        <span>{commitError.message}</span>
      </div>
    );
  }
  if (!commit) return <div className="app-log-details" />;
  return (
    <section className="app-log-details" aria-label="Commit details">
      <div className={`app-log-message ${commit.merged ? "is-merge" : ""}`}>
        <div className="ui-heading">{commit.subject}</div>
        <div className="app-log-meta">
          <span className="app-mono">{commit.short}</span> · {commit.author} ·{" "}
          {fullDate(commit.time)}
          {commit.merged && (
            <>
              {" "}
              · parents{" "}
              {commit.parents.map((parent, i) => (
                <span key={parent}>
                  {i > 0 && ", "}
                  <span className="app-mono">{parent.slice(0, 8)}</span>
                </span>
              ))}
            </>
          )}
        </div>
        {commit.body && <div className="app-log-body">{commit.body}</div>}
        {commit.merged && (
          <div className="dl-banner is-info">
            <Icon name="status-info" />
            <span className="dl-banner-text">
              Shows only what this merge changed beyond git's automatic merge, such as conflict
              fixes. {target ?? "The target branch"}'s own commits are left out.
            </span>
          </div>
        )}
      </div>
      <CommitFiles commit={commit} files={files} />
    </section>
  );
}

function CommitFiles({
  commit,
  files,
}: {
  commit: CommitDetails;
  files: RefObject<HTMLDivElement | null>;
}) {
  const selected = useApp((state) => state.logFile);
  const selectLogFile = useApp((state) => state.selectLogFile);
  const index = commit.files.findIndex((file) => file.path === selected);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const next = commit.files[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) selectLogFile(next.path);
  };
  const keepFocus = (event: MouseEvent) => {
    event.preventDefault();
    files.current?.focus();
  };
  return (
    <div
      ref={files}
      className="dl-list app-log-files"
      role="listbox"
      aria-label="Changed files"
      tabIndex={0}
      aria-activedescendant={index >= 0 ? `commit-file-${index}` : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="dl-row dl-row-group">
        <Icon name="general-chevronDown" />
        <span>{commit.merged ? "Changed by the merge" : "Changed files"}</span>
        <span className="dl-row-count">{fileCount(commit.files.length)}</span>
      </div>
      {commit.files.length === 0 && (
        <div className="dl-row app-log-none" style={{ "--depth": 1 } as React.CSSProperties}>
          {commit.merged ? "Clean merge: no manual changes" : "This commit changes no files"}
        </div>
      )}
      {commit.files.map((file, i) => {
        const { name, folder } = splitPath(file.path);
        const isSelected = file.path === selected;
        return (
          <div
            key={file.path}
            id={`commit-file-${i}`}
            className={`dl-row ${isSelected ? "is-selected" : ""}`}
            role="option"
            aria-selected={isSelected}
            aria-label={file.path}
            title={file.oldPath ? `Renamed from ${file.oldPath}` : undefined}
            style={{ "--depth": 1 } as React.CSSProperties}
            tabIndex={-1}
            onMouseDown={keepFocus}
            onClick={() => selectLogFile(file.path)}
            onKeyDown={(event) => onActivateKey(event, () => selectLogFile(file.path))}
          >
            <span className={`dl-i ${fileIcon(file.path)}`} aria-hidden="true" />
            <span className={`dl-row-name ${statusClass(file.kind)}`}>{name}</span>
            <span className="dl-row-path">{folder}</span>
          </div>
        );
      })}
    </div>
  );
}

function onActivateKey(event: KeyboardEvent<HTMLDivElement>, activate: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  activate();
}
