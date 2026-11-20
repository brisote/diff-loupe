import type { ProjectEntry } from "../api";

export type ProjectTreeRow = {
  entry: ProjectEntry;
  depth: number;
  expanded: boolean;
};

export function buildProjectRows(
  dirs: Record<string, ProjectEntry[]>,
  expanded: Record<string, boolean>,
  filter: string,
): ProjectTreeRow[] {
  const needle = filter.trim().toLowerCase();
  const rows: ProjectTreeRow[] = [];

  const visit = (dir: string, depth: number) => {
    const entries = dirs[dir];
    if (!entries) return;
    for (const entry of entries) {
      const isExpanded = entry.isDir && Boolean(expanded[entry.path]);
      if (!needle) {
        rows.push({ entry, depth, expanded: isExpanded });
        if (isExpanded) visit(entry.path, depth + 1);
      } else {
        const matchesSelf =
          entry.name.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle);
        const start = rows.length;
        if (entry.isDir) {
          rows.push({ entry, depth, expanded: true });
          visit(entry.path, depth + 1);
          const hasMatchingDescendant = rows.length > start + 1;
          if (!matchesSelf && !hasMatchingDescendant) {
            rows.pop();
          }
        } else if (matchesSelf) {
          rows.push({ entry, depth, expanded: false });
        }
      }
    }
  };

  visit("", 0);
  return rows;
}
