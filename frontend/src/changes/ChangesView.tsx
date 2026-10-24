import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../lib/icon";
import { useApp } from "../state/context";
import { changesMeasure, openMark } from "../state/store";
import { fileIcon } from "./fileIcons";
import {
  buildRows,
  fileCount,
  type GroupId,
  isTracked,
  type ListRow,
  nextFile,
  selectionKey,
  statusClass,
} from "./rows";

const rowHeight = 24;

export function ChangesView() {
  const changes = useApp((state) => state.changes);
  const uncommitted = useApp((state) => state.uncommitted);
  const target = useApp((state) => state.repo?.target ?? null);
  const statusError = useApp((state) => state.statusError);
  const branch = useApp((state) => state.repo?.branch);
  const path = useApp((state) => state.repo?.lastSelection ?? null);
  const staged = useApp((state) => state.selectedStaged);
  const selection = selectionKey(changes, path, staged);
  const loadStatus = useApp((state) => state.loadStatus);
  const select = useApp((state) => state.select);
  const showDialog = useApp((state) => state.showDialog);
  const merging = useApp((state) => Boolean(state.merge?.operation));
  const [collapsed, setCollapsed] = useState<ReadonlySet<GroupId>>(new Set());
  const loaded = changes !== null;

  useEffect(() => {
    if (loaded && performance.getEntriesByName(openMark).length > 0) {
      performance.measure(changesMeasure, openMark);
      performance.clearMarks(openMark);
    }
  }, [loaded]);

  const rows = useMemo(() => buildRows(changes ?? [], { collapsed }), [changes, collapsed]);
  const toggle = (id: GroupId) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="dl-toolbar app-changes-toolbar" role="toolbar" aria-label="Changes actions">
        <button
          className="dl-tbtn"
          type="button"
          aria-label="Refresh"
          title="Refresh"
          onClick={() => void loadStatus()}
        >
          <Icon name="general-refresh" />
        </button>
        <button
          className="dl-tbtn"
          type="button"
          aria-label="Commit… ⌘K"
          title="Commit… ⌘K"
          disabled={!uncommitted || uncommitted.length === 0}
          onClick={() => showDialog("commit")}
        >
          <Icon name="vcs-commit" />
        </button>
        <button
          className="dl-tbtn"
          type="button"
          aria-label="Rollback…"
          title={merging ? "Commit or abort the merge first" : "Rollback…"}
          disabled={merging || !uncommitted?.some(isTracked)}
          onClick={() => showDialog("rollback")}
        >
          <Icon name="vcs-revert" />
        </button>
      </div>
      {statusError ? (
        <div className="dl-empty app-fill" role="alert">
          <span className="dl-empty-title">The changes could not be read</span>
          <span>{statusError.message}</span>
        </div>
      ) : changes === null ? null : rows.length === 0 ? (
        <div className="dl-empty app-fill">
          <span className="dl-empty-title">No changes</span>
          <span>
            The working tree matches {target && target !== branch ? target : (branch ?? "HEAD")}.
            Committed work is in the Branch log.
          </span>
        </div>
      ) : (
        <ChangesList rows={rows} selection={selection} onSelect={select} onToggle={toggle} />
      )}
    </>
  );
}

type ListProps = {
  rows: ListRow[];
  selection: string | null;
  onSelect: (path: string) => void;
  onToggle: (id: GroupId) => void;
};

function ChangesList({ rows, selection, onSelect, onToggle }: ListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    initialRect: { width: 400, height: 600 },
  });
  const selectedIndex = rows.findIndex((row) => row.type === "file" && row.id === selection);
  const items = virtualizer.getVirtualItems();
  const active = items.some((item) => item.index === selectedIndex)
    ? `change-row-${selectedIndex}`
    : undefined;

  const keepFocus = (event: MouseEvent) => {
    event.preventDefault();
    scroller.current?.focus();
  };
  const move = (step: 1 | -1) => {
    const next = nextFile(rows, selection, step);
    if (!next) return;
    onSelect(next);
    const index = rows.findIndex((row) => row.type === "file" && row.id === next);
    if (index >= 0) virtualizer.scrollToIndex(index);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    }
  };

  return (
    <div
      ref={scroller}
      className="dl-list app-changes-list"
      role="tree"
      aria-label="Changed files"
      tabIndex={0}
      aria-activedescendant={active}
      onKeyDown={onKeyDown}
    >
      <div className="app-virtual" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          const style = { transform: `translateY(${item.start}px)` };
          if (row.type === "group") {
            return (
              <div
                key={`group-${row.id}`}
                id={`change-row-${item.index}`}
                className="dl-row dl-row-group app-virtual-row"
                role="treeitem"
                aria-level={1}
                aria-selected={false}
                aria-expanded={row.expanded}
                tabIndex={-1}
                style={style}
                onMouseDown={keepFocus}
                onClick={() => onToggle(row.id)}
                onKeyDown={(event) => onActivateKey(event, () => onToggle(row.id))}
              >
                <Icon name={row.expanded ? "general-chevronDown" : "general-chevronRight"} />
                <span>{row.label}</span>
                <span className="dl-row-count">{fileCount(row.count)}</span>
              </div>
            );
          }
          const renamed = row.change.oldPath ? `Renamed from ${row.change.oldPath}` : undefined;
          return (
            <div
              key={`${row.group}:${row.id}`}
              id={`change-row-${item.index}`}
              className={`dl-row app-virtual-row ${row.id === selection ? "is-selected" : ""}`}
              role="treeitem"
              aria-level={2}
              aria-selected={row.id === selection}
              tabIndex={-1}
              aria-label={row.group === "staged" ? `${row.change.path}, staged` : row.change.path}
              title={renamed}
              style={{ ...style, "--depth": 1 } as React.CSSProperties}
              onMouseDown={keepFocus}
              onClick={() => onSelect(row.id)}
              onKeyDown={(event) => onActivateKey(event, () => onSelect(row.id))}
            >
              <span className={`dl-i ${fileIcon(row.change.path)}`} aria-hidden="true" />
              <span className={`dl-row-name ${statusClass(row.change.kind)}`}>{row.name}</span>
              <span className="dl-row-path">{row.folder}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function onActivateKey(event: KeyboardEvent<HTMLDivElement>, activate: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  activate();
}
