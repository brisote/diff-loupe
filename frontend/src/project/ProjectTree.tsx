import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fileIcon } from "../changes/fileIcons";
import { Icon } from "../lib/icon";
import { useApp } from "../state/context";
import { buildProjectRows, type ProjectTreeRow } from "./treeRows";

const rowHeight = 24;

export function ProjectTree({ width }: { width: number }) {
  const repo = useApp((state) => state.repo);
  const dirs = useApp((state) => state.projectDirs);
  const expanded = useApp((state) => state.projectExpanded);
  const selected = useApp((state) => state.projectSelectedFile);
  const error = useApp((state) => state.projectTreeError);
  const loadProjectDir = useApp((state) => state.loadProjectDir);
  const toggleProjectDir = useApp((state) => state.toggleProjectDir);
  const collapseAllProjectDirs = useApp((state) => state.collapseAllProjectDirs);
  const selectProjectFile = useApp((state) => state.selectProjectFile);
  const refreshProjectTree = useApp((state) => state.refreshProjectTree);
  const [filter, setFilter] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const parent = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (repo && !dirs[""]) {
      void loadProjectDir("");
    }
  }, [repo, dirs, loadProjectDir]);

  const rows = useMemo(() => buildProjectRows(dirs, expanded, filter), [dirs, expanded, filter]);
  const rootLoaded = Boolean(dirs[""]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  const activePath = focused ?? selected;
  const activeIndex = activePath ? rows.findIndex((row) => row.entry.path === activePath) : -1;

  const activate = (row: ProjectTreeRow) => {
    setFocused(row.entry.path);
    if (row.entry.isDir) {
      void toggleProjectDir(row.entry.path);
    } else {
      void selectProjectFile(row.entry.path);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = rows[Math.min(rows.length - 1, activeIndex + 1)];
      if (next) {
        setFocused(next.entry.path);
        virtualizer.scrollToIndex(Math.min(rows.length - 1, activeIndex + 1));
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const idx = activeIndex <= 0 ? 0 : activeIndex - 1;
      const prev = rows[idx];
      if (prev) {
        setFocused(prev.entry.path);
        virtualizer.scrollToIndex(idx);
      }
    } else if (event.key === "ArrowRight" && activeIndex >= 0) {
      const current = rows[activeIndex];
      if (current?.entry.isDir && !current.expanded) {
        event.preventDefault();
        void toggleProjectDir(current.entry.path);
      }
    } else if (event.key === "ArrowLeft" && activeIndex >= 0) {
      const current = rows[activeIndex];
      if (current?.entry.isDir && current.expanded) {
        event.preventDefault();
        void toggleProjectDir(current.entry.path);
      }
    } else if (event.key === "Enter" && activeIndex >= 0) {
      const current = rows[activeIndex];
      if (current) {
        event.preventDefault();
        activate(current);
      }
    }
  };

  if (!repo) return null;

  return (
    <section className="dl-island app-tool" style={{ width }} aria-label="Project">
      <header className="dl-island-header">
        <span className="dl-island-title">Project</span>
        <span className="dl-toolbar-spacer" />
        <button
          className="dl-tbtn"
          type="button"
          aria-label="Refresh"
          title="Refresh"
          onClick={() => void refreshProjectTree()}
        >
          <Icon name="general-refresh" />
        </button>
        <button
          className="dl-tbtn"
          type="button"
          aria-label="Collapse all"
          title="Collapse all"
          onClick={collapseAllProjectDirs}
        >
          <Icon name="general-collapseAll" />
        </button>
      </header>
      <div className="dl-toolbar app-changes-toolbar" role="toolbar" aria-label="Project actions">
        <label className="dl-field app-file-filter" htmlFor="project-file-filter">
          <Icon name="general-search" />
          <input
            id="project-file-filter"
            placeholder="Filter files"
            aria-label="Filter files"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      </div>
      <div className="dl-island-body app-tool-body">
        {error ? (
          <div className="dl-empty app-fill" role="alert">
            <span className="dl-empty-title">The project files could not be read</span>
            <span>{error.message}</span>
          </div>
        ) : !rootLoaded ? null : rows.length === 0 ? (
          <div className="dl-empty app-fill">
            {filter.trim().length > 0 ? (
              <>
                <span className="dl-empty-title">No matching files</span>
                <span>Change the filter to see more.</span>
              </>
            ) : (
              <>
                <span className="dl-empty-title">Empty repository</span>
                <span>Files in this repository show here.</span>
              </>
            )}
          </div>
        ) : (
          <div
            ref={parent}
            className="dl-list app-list"
            role="tree"
            aria-label="Project files"
            tabIndex={0}
            onKeyDown={onKeyDown}
          >
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                if (!row) return null;
                const { entry, depth, expanded: isExpanded } = row;
                const isSelected = entry.path === selected;
                const isFocused = entry.path === activePath;
                const iconClass = entry.isDir ? "dl-i-nodes-folder" : fileIcon(entry.path);
                return (
                  <div
                    key={entry.path}
                    role="treeitem"
                    tabIndex={-1}
                    aria-selected={isSelected}
                    aria-expanded={entry.isDir ? isExpanded : undefined}
                    className={`dl-row ${isSelected ? "is-selected" : ""} ${entry.ignored ? "is-ignored" : ""} ${isFocused && !isSelected ? "is-focused" : ""}`}
                    style={
                      {
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        transform: `translateY(${item.start}px)`,
                        "--depth": depth,
                      } as CSSProperties
                    }
                    title={entry.path}
                    onClick={() => activate(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        activate(row);
                      }
                    }}
                  >
                    <span className="dl-tree-chevron" aria-hidden="true">
                      {entry.isDir && (
                        <Icon name={isExpanded ? "general-chevronDown" : "general-chevronRight"} />
                      )}
                    </span>
                    <span className={`dl-i ${iconClass}`} aria-hidden="true" />
                    <span className="dl-row-name">{entry.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
