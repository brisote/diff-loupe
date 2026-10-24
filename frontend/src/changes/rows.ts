import type { Area } from "../api/generated/Area";
import type { ChangeKind } from "../api/generated/ChangeKind";
import type { FileChange } from "../api/generated/FileChange";
import { splitPath } from "../lib/paths";

export type GroupId = "conflicts" | "staged" | "changes" | "unversioned";

export type ListRow =
  | { type: "group"; id: GroupId; label: string; count: number; expanded: boolean }
  | { type: "file"; id: string; group: GroupId; change: FileChange; name: string; folder: string };

export type RowOptions = { collapsed: ReadonlySet<GroupId> };

const groupLabels: Record<GroupId, string> = {
  conflicts: "Merge Conflicts",
  staged: "Staged",
  changes: "Changes",
  unversioned: "Unversioned Files",
};

export function isTracked(change: FileChange): boolean {
  return change.kind !== "untracked" && change.kind !== "conflicted";
}

export function inStaged(change: FileChange): boolean {
  return isTracked(change) && change.staged;
}

export function inChanges(change: FileChange): boolean {
  return isTracked(change) && (!change.staged || change.unstaged);
}

const stagedPrefix = "\u0000staged\u0000";

export function rowKey(group: GroupId, path: string): string {
  return group === "staged" ? `${stagedPrefix}${path}` : path;
}

export function parseKey(key: string): { path: string; staged: boolean } {
  return key.startsWith(stagedPrefix)
    ? { path: key.slice(stagedPrefix.length), staged: true }
    : { path: key, staged: false };
}

export function showsStaged(change: FileChange, staged: boolean): boolean {
  return inStaged(change) && (staged || !inChanges(change));
}

export function areaFor(change: FileChange, staged: boolean): Area | undefined {
  if (showsStaged(change, staged)) return "staged";
  return inStaged(change) ? "unstaged" : undefined;
}

export function selectionKey(
  changes: FileChange[] | null,
  path: string | null,
  staged: boolean,
): string | null {
  if (path === null) return null;
  const change = changes?.find((c) => c.path === path);
  return change && showsStaged(change, staged) ? rowKey("staged", path) : path;
}

export function fileCount(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

export function statusClass(kind: ChangeKind): string {
  switch (kind) {
    case "added":
      return "st-added";
    case "deleted":
      return "st-deleted";
    case "untracked":
      return "st-unversioned";
    case "conflicted":
      return "st-conflict";
    default:
      return "st-modified";
  }
}

export function buildRows(changes: FileChange[], options: RowOptions): ListRow[] {
  const byPath = (a: FileChange, b: FileChange) =>
    a.path.localeCompare(b.path, undefined, { sensitivity: "base" });
  const groups: [GroupId, FileChange[]][] = [
    ["conflicts", changes.filter((c) => c.kind === "conflicted").sort(byPath)],
    ["staged", changes.filter(inStaged).sort(byPath)],
    ["changes", changes.filter(inChanges).sort(byPath)],
    ["unversioned", changes.filter((c) => c.kind === "untracked").sort(byPath)],
  ];
  const rows: ListRow[] = [];
  for (const [id, files] of groups) {
    if (files.length === 0) continue;
    const expanded = !options.collapsed.has(id);
    rows.push({ type: "group", id, label: groupLabels[id], count: files.length, expanded });
    if (!expanded) continue;
    for (const change of files)
      rows.push({
        type: "file",
        id: rowKey(id, change.path),
        group: id,
        change,
        ...splitPath(change.path),
      });
  }
  return rows;
}

export function nextFile(rows: ListRow[], current: string | null, step: 1 | -1): string | null {
  const files = rows.flatMap((row) => (row.type === "file" ? [row.id] : []));
  if (files.length === 0) return null;
  const index = current === null ? -1 : files.indexOf(current);
  if (index < 0) return step === 1 ? (files[0] ?? null) : (files[files.length - 1] ?? null);
  return files[Math.min(Math.max(index + step, 0), files.length - 1)] ?? null;
}
