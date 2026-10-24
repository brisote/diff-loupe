import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FileChange } from "../api";
import { rowKey } from "../changes/rows";
import { fakeCore, renderWithStore, repoInfo } from "../test/render";
import { CommitDialog, commitGroups, commitPaths, defaultPicks, groupCount } from "./CommitDialog";

const change = (path: string, kind: FileChange["kind"], oldPath: string | null = null) => ({
  path,
  oldPath,
  headPath: oldPath,
  kind,
  staged: false,
  unstaged: true,
  unchanged: false,
});

const changes = [
  change("src/a.kt", "modified"),
  change("src/new.kt", "renamed", "src/old.kt"),
  change("notes.md", "untracked"),
];

describe("commit helpers", () => {
  it("sends both paths of a rename", () => {
    expect(commitPaths(changes, new Set(["src/new.kt", "notes.md"]))).toEqual({
      files: ["src/old.kt", "src/new.kt", "notes.md"],
      staged: [],
    });
  });

  it("lists a file staged and edited again in both groups and ticks only staged rows", () => {
    const staged = [
      { ...change("notes_v1.md", "added"), staged: true, unstaged: true },
      { ...change("src/b.kt", "renamed", "src/a.kt"), staged: true, unstaged: false },
      change("src/c.kt", "modified"),
    ];
    expect(commitGroups(staged).map((group) => [group.id, group.files.map((f) => f.path)])).toEqual(
      [
        ["staged", ["notes_v1.md", "src/b.kt"]],
        ["changes", ["notes_v1.md", "src/c.kt"]],
      ],
    );
    const picks = defaultPicks(staged);
    expect([...picks].sort()).toEqual(
      [rowKey("staged", "notes_v1.md"), rowKey("staged", "src/b.kt")].sort(),
    );
    expect(commitPaths(staged, picks)).toEqual({
      files: [],
      staged: ["notes_v1.md", "src/a.kt", "src/b.kt"],
    });
    expect(commitPaths(staged, new Set(["notes_v1.md", "src/c.kt"]))).toEqual({
      files: ["notes_v1.md", "src/c.kt"],
      staged: [],
    });
    expect([...defaultPicks(changes)].sort()).toEqual(["src/a.kt", "src/new.kt"]);
  });

  it("counts ticked files only when some are left out", () => {
    expect(groupCount(5, 4)).toBe("4 of 5 files");
    expect(groupCount(5, 5)).toBe("5 files");
    expect(groupCount(1, 0)).toBe("1 file");
  });
});

describe("CommitDialog", () => {
  it("ticks tracked files, commits the ticked paths and closes", async () => {
    const user = userEvent.setup();
    const transport = fakeCore({
      current_repo: () => ({
        ...repoInfo("acme-billing", "gs/invoice-export"),
        lastTab: "changes",
      }),
      status: () => changes,
      commit: () => ({ id: "a".repeat(40), short: "aaaaaaaa" }),
    });
    const { store } = await renderWithStore(<CommitDialog />, transport);
    store.getState().showDialog("commit");
    await screen.findByText("2 files");
    expect(screen.getByRole("checkbox", { name: "notes.md" })).not.toBeChecked();
    const commit = screen.getByRole("button", { name: /^Commit$/ });
    expect(commit).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Commit message" }), "Rename");
    await user.click(screen.getByRole("checkbox", { name: "src/a.kt" }));
    expect(screen.getByText("1 of 2 files")).toBeInTheDocument();
    await user.click(commit);
    expect(transport.calls.find((call) => call.cmd === "commit")?.args).toEqual({
      path: "/Users/ada/Workspace/acme-billing",
      message: "Rename",
      amend: false,
      files: ["src/old.kt", "src/new.kt"],
      staged: [],
    });
    expect(store.getState().dialog).toBeNull();
  });
});
