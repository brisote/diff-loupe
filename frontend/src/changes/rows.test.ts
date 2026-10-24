import { describe, expect, it } from "vitest";
import type { FileChange } from "../api";
import { fileIcon } from "./fileIcons";
import {
  areaFor,
  buildRows,
  fileCount,
  nextFile,
  parseKey,
  rowKey,
  selectionKey,
  statusClass,
} from "./rows";

function change(path: string, kind: FileChange["kind"]): FileChange {
  return {
    path,
    oldPath: null,
    headPath: null,
    kind,
    staged: false,
    unstaged: true,
    unchanged: false,
  };
}

const changes = [
  change("web/src/exportButton.tsx", "untracked"),
  change("README.md", "modified"),
  change("billing/Invoice.kt", "added"),
  change("config/legacy.yaml", "deleted"),
  change("both.txt", "conflicted"),
];

describe("buildRows", () => {
  it("groups conflicts, tracked changes and unversioned files, sorted by path", () => {
    const rows = buildRows(changes, { collapsed: new Set() });
    expect(
      rows.map((row) => (row.type === "group" ? `# ${row.label} ${row.count}` : row.id)),
    ).toEqual([
      "# Merge Conflicts 1",
      "both.txt",
      "# Changes 3",
      "billing/Invoice.kt",
      "config/legacy.yaml",
      "README.md",
      "# Unversioned Files 1",
      "web/src/exportButton.tsx",
    ]);
  });

  it("hides the files of collapsed groups", () => {
    const rows = buildRows(changes, { collapsed: new Set(["conflicts", "changes"]) });
    expect(rows.filter((row) => row.type === "group")).toEqual([
      { type: "group", id: "conflicts", label: "Merge Conflicts", count: 1, expanded: false },
      { type: "group", id: "changes", label: "Changes", count: 3, expanded: false },
      { type: "group", id: "unversioned", label: "Unversioned Files", count: 1, expanded: true },
    ]);
    expect(rows.filter((row) => row.type === "file").map((row) => row.id)).toEqual([
      "web/src/exportButton.tsx",
    ]);
  });
});

describe("helpers", () => {
  it("moves between files and skips group rows", () => {
    const rows = buildRows(changes, { collapsed: new Set() });
    expect(nextFile(rows, null, 1)).toBe("both.txt");
    expect(nextFile(rows, "both.txt", 1)).toBe("billing/Invoice.kt");
    expect(nextFile(rows, null, -1)).toBe("web/src/exportButton.tsx");
    expect(nextFile(rows, "README.md", 1)).toBe("web/src/exportButton.tsx");
    expect(nextFile(rows, "billing/Invoice.kt", -1)).toBe("both.txt");
    expect(nextFile(rows, "both.txt", -1)).toBe("both.txt");
    expect(nextFile([], null, 1)).toBeNull();
  });

  it("counts files and colours statuses", () => {
    expect(fileCount(1)).toBe("1 file");
    expect(fileCount(5)).toBe("5 files");
    expect(statusClass("renamed")).toBe("st-modified");
    expect(statusClass("untracked")).toBe("st-unversioned");
  });

  it("picks file icons by name and extension", () => {
    expect(fileIcon("billing/InvoiceExporter.kt")).toBe("dl-ft-kotlin");
    expect(fileIcon("web/exportButton.TSX")).toBe("dl-ft-typeScript");
    expect(fileIcon("Gemfile")).toBe("dl-ft-ruby");
    expect(fileIcon("docs/logo.png")).toBe("dl-ft-image");
    expect(fileIcon(".env")).toBe("dl-ft-unknown");
    expect(fileIcon("LICENSE")).toBe("dl-ft-unknown");
    expect(fileIcon("vendor/lib/")).toBe("dl-i-nodes-folder");
  });
});

describe("staged files", () => {
  const staged = (path: string, unstaged: boolean): FileChange => ({
    ...change(path, "modified"),
    staged: true,
    unstaged,
  });
  const files = [staged("both.md", true), staged("only.md", false), change("plain.md", "modified")];

  it("lists staged files in their own group and a file edited after staging in both", () => {
    const rows = buildRows(files, { collapsed: new Set() });
    expect(
      rows.map((row) =>
        row.type === "group" ? `# ${row.label}` : `${row.group} ${row.change.path}`,
      ),
    ).toEqual([
      "# Staged",
      "staged both.md",
      "staged only.md",
      "# Changes",
      "changes both.md",
      "changes plain.md",
    ]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("maps each row to the diff it shows", () => {
    const [both, only, plain] = files as [FileChange, FileChange, FileChange];
    expect(areaFor(both, true)).toBe("staged");
    expect(areaFor(both, false)).toBe("unstaged");
    expect(areaFor(only, false)).toBe("staged");
    expect(areaFor(plain, true)).toBeUndefined();
    expect(selectionKey(files, "only.md", false)).toBe(rowKey("staged", "only.md"));
    expect(selectionKey(files, "plain.md", true)).toBe("plain.md");
    expect(parseKey(rowKey("staged", "a b.md"))).toEqual({ path: "a b.md", staged: true });
    expect(parseKey("a b.md")).toEqual({ path: "a b.md", staged: false });
  });
});
