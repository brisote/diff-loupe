import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CommitDetails, LogEntry } from "../api";
import { fileIcon } from "../changes/fileIcons";
import { fileCount, statusClass } from "../changes/rows";
import { fullDate, relativeDate } from "../lib/dates";
import { Icon } from "../lib/icon";
import { MenuRow } from "../lib/list";
import { splitPath } from "../lib/paths";
import { Popup } from "../lib/popup";
import { clampWidth, Splitter } from "../main-window/Splitter";
import { useApp } from "../state/context";

const rowHeight = 24;
export const detailsHeightKey = "logDetailsHeight";
const defaultDetails = 320;
const minDetails = 120;
const minCommits = 96;
const splitterSize = 6;
const menuWidth = 200;
const menuHeight = 40;

export function commitCount(count: number): string {
  return count === 1 ? "1 commit" : `${count} commits`;
}

export function matches(entry: LogEntry, filter: string): boolean {
  const wanted = filter.trim().toLowerCase();
  if (!wanted) return true;
  const text = `${entry.short} ${entry.subject} ${entry.author}`;
  return text.toLowerCase().includes(wanted) || entry.id.startsWith(wanted);
}

export function BranchLogView() {
  const log = useApp((state) => state.log);
  const logError = useApp((state) => state.logError);
  const loadLog = useApp((state) => state.loadLog);
  const backend = useApp((state) => state.backend);
  const [filter, setFilter] = useState("");
  const [details, setDetails] = useState(defaultDetails);
  const [room, setRoom] = useState(600);
  const files = useRef<HTMLDivElement>(null);
  const panes = useRef<HTMLDivElement>(null);
  const shown = log !== null && log.entries.length > 0;

  useEffect(() => {
    void backend
      .call("get_ui_value", { key: detailsHeightKey })
      .then((saved) => {
        const value = Number(saved);
        if (saved && Number.isFinite(value)) setDetails(value);
      })
      .catch(() => undefined);
  }, [backend]);

  useEffect(() => {
    const element = panes.current;
    if (!shown || !element) return;
    const measure = () => setRoom(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shown]);

  const maxDetails = Math.max(minDetails, room - minCommits - splitterSize);
  const height = clampWidth(details, minDetails, maxDetails);
  const saveDetails = (value: number) =>
    void backend
      .call("set_ui_value", { key: detailsHeightKey, value: String(value) })
      .catch(() => undefined);
  const entries = useMemo(
    () => (log ? log.entries.filter((entry) => matches(entry, filter)) : []),
    [log, filter],
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
          <span className="dl-empty-title">No commits yet</span>
          <span>The branch has no commits.</span>
        </div>
      ) : (
        <>
          <div className="dl-row dl-row-group app-log-head">
            <span>Branch commit history</span>
            <span className="dl-row-count">
              {log.truncated
                ? `Latest ${commitCount(log.entries.length)}`
                : commitCount(log.entries.length)}
            </span>
          </div>
          <div className="app-log-panes" ref={panes}>
            <CommitList
              entries={entries}
              files={files}
              first={log.entries[0]?.id}
              last={log.truncated ? undefined : log.entries[log.entries.length - 1]?.id}
            />
            <Splitter
              vertical
              label="Resize the commit list"
              width={height}
              min={minDetails}
              max={maxDetails}
              onResize={setDetails}
              onResizeEnd={saveDetails}
            />
            <CommitPane files={files} height={height} />
          </div>
        </>
      )}
    </>
  );
}

type ListProps = {
  entries: LogEntry[];
  files: RefObject<HTMLDivElement | null>;
  first: string | undefined;
  last: string | undefined;
};

type Menu = { id: string; x: number; y: number };

export function commitClass(entry: LogEntry, first?: string, last?: string): string {
  return [
    entry.id === first ? "is-first" : "",
    entry.id === last ? "is-last" : "",
    entry.merge ? "is-merge" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function CommitList({ entries, files, first, last }: ListProps) {
  const selected = useApp((state) => state.logCommit);
  const selectCommit = useApp((state) => state.selectCommit);
  const [menu, setMenu] = useState<Menu | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
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
  const openMenu = (id: string, x: number, y: number) =>
    setMenu({
      id,
      x: Math.max(0, Math.min(x, window.innerWidth - menuWidth)),
      y: Math.max(0, Math.min(y, window.innerHeight - menuHeight)),
    });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const entry = entries[index];
    if (entry && (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))) {
      event.preventDefault();
      const row = document.getElementById(`commit-row-${index}`)?.getBoundingClientRect();
      openMenu(entry.id, row ? row.left + 24 : 0, row ? row.bottom : 0);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
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
    <>
      <div
        ref={scroller}
        className="dl-list app-log-commits"
        role="listbox"
        aria-label="Branch commits"
        tabIndex={0}
        aria-activedescendant={active}
        onKeyDown={onKeyDown}
        onScroll={closeMenu}
      >
        <div className="app-virtual" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const entry = entries[item.index];
            if (!entry) return null;
            const isSelected = entry.id === selected;
            return (
              <div
                key={entry.id}
                id={`commit-row-${item.index}`}
                className={`dl-row dl-commit app-virtual-row ${commitClass(entry, first, last)} ${isSelected ? "is-selected" : ""}`}
                role="option"
                aria-selected={isSelected}
                aria-label={entry.subject}
                style={{ transform: `translateY(${item.start}px)` }}
                tabIndex={-1}
                onMouseDown={keepFocus}
                onClick={() => selectCommit(entry.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  selectCommit(entry.id);
                  openMenu(entry.id, event.clientX, event.clientY);
                }}
                onKeyDown={(event) => onActivateKey(event, () => selectCommit(entry.id))}
              >
                <span className="dl-commit-graph" aria-hidden="true">
                  <i className="dl-commit-dot" />
                </span>
                <span className="dl-commit-subject">{entry.subject}</span>
                <span className="dl-commit-meta">{entry.author}</span>
                <span className="dl-commit-meta">{relativeDate(entry.time)}</span>
              </div>
            );
          })}
        </div>
      </div>
      {menu && (
        <Popup
          label="Commit actions"
          role="menu"
          className="app-context-menu"
          style={{ top: menu.y, left: menu.x }}
          onClose={closeMenu}
        >
          <MenuRow
            label="Copy Revision Number"
            onActivate={() => {
              void navigator.clipboard?.writeText(menu.id);
              closeMenu();
            }}
          >
            <Icon name="general-copy" />
            <span className="dl-row-name app-row-wide">Copy Revision Number</span>
          </MenuRow>
        </Popup>
      )}
    </>
  );
}

function CommitPane({
  files,
  height,
}: {
  files: RefObject<HTMLDivElement | null>;
  height: number;
}) {
  const size = { height };
  const commit = useApp((state) => state.commit);
  const commitError = useApp((state) => state.commitError);
  const selected = useApp((state) => state.logCommit);
  if (!selected) {
    return (
      <div className="dl-empty app-log-details" style={size}>
        <span className="dl-empty-title">Pick a commit</span>
        <span>Its message and changed files show here.</span>
      </div>
    );
  }
  if (commitError) {
    return (
      <div className="dl-empty app-log-details" style={size} role="alert">
        <span className="dl-empty-title">The commit could not be read</span>
        <span>{commitError.message}</span>
      </div>
    );
  }
  if (!commit) return <div className="app-log-details" style={size} />;
  return (
    <section className="app-log-details" style={size} aria-label="Commit details">
      <div className="app-log-message">
        <div className="ui-heading">{commit.subject}</div>
        <div className="app-log-meta">
          <span className="app-mono">{commit.short}</span> · {commit.author} ·{" "}
          {fullDate(commit.time)}
          {commit.parents.length > 1 && (
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
        <span>Changed files</span>
        <span className="dl-row-count">{fileCount(commit.files.length)}</span>
      </div>
      {commit.files.length === 0 && (
        <div className="dl-row app-log-none" style={{ "--depth": 1 } as React.CSSProperties}>
          This commit changes no files
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
