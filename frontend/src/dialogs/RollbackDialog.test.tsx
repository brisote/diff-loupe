import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FileChange } from "../api";
import { fakeCore, renderWithStore, repoInfo } from "../test/render";
import { RollbackDialog, rollbackFiles, rollbackPaths, rollbackPicks } from "./RollbackDialog";

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
  change("src/b.kt", "modified"),
  change("src/new.kt", "renamed", "src/old.kt"),
  change("notes.md", "untracked"),
  { ...change("src/a.kt", "added"), staged: true, unstaged: false },
];

describe("rollback helpers", () => {
  it("offers tracked files only and sends both paths of a rename", () => {
    const files = rollbackFiles(changes);
    expect(files.map((file) => file.path)).toEqual(["src/a.kt", "src/b.kt", "src/new.kt"]);
    expect(rollbackPaths(files, new Set(["src/new.kt", "src/b.kt"]))).toEqual([
      "src/b.kt",
      "src/old.kt",
      "src/new.kt",
    ]);
  });

  it("leaves the source of a copy alone", () => {
    const copy = change("src/copy.kt", "copied", "src/source.kt");
    expect(rollbackPaths([copy], new Set(["src/copy.kt"]))).toEqual(["src/copy.kt"]);
  });

  it("ticks the selected file, or every file when the selection is not one of them", () => {
    const files = rollbackFiles(changes);
    expect([...rollbackPicks(files, "src/b.kt")]).toEqual(["src/b.kt"]);
    expect([...rollbackPicks(files, "notes.md")]).toEqual(["src/a.kt", "src/b.kt", "src/new.kt"]);
  });
});

describe("RollbackDialog", () => {
  it("rolls back the ticked files and asks before deleting added copies", async () => {
    const user = userEvent.setup();
    const transport = fakeCore({
      current_repo: () => ({
        ...repoInfo("acme-billing", "gs/invoice-export"),
        lastTab: "changes",
        lastSelection: "src/b.kt",
      }),
      status: () => changes,
      rollback: () => null,
    });
    const { store } = await renderWithStore(<RollbackDialog />, transport);
    store.getState().showDialog("rollback");
    await screen.findByText("1 of 3 files");
    expect(screen.getByRole("checkbox", { name: "src/b.kt" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "notes.md" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Delete local copies of added files" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "src/a.kt" }));
    await user.click(screen.getByRole("checkbox", { name: "Delete local copies of added files" }));
    await user.click(screen.getByRole("button", { name: "Rollback" }));
    expect(transport.calls.find((call) => call.cmd === "rollback")?.args).toEqual({
      path: "/Users/ada/Workspace/acme-billing",
      files: ["src/a.kt", "src/b.kt"],
      deleteAdded: true,
    });
    expect(store.getState().dialog).toBeNull();
  });

  it("keeps the dialog open and shows git's message when the rollback fails", async () => {
    const user = userEvent.setup();
    const transport = fakeCore({
      current_repo: () => ({
        ...repoInfo("acme-billing", "gs/invoice-export"),
        lastTab: "changes",
      }),
      status: () => changes,
      rollback: () => {
        throw { code: "gitRefused", message: "A merge is in progress." };
      },
    });
    const { store } = await renderWithStore(<RollbackDialog />, transport);
    store.getState().showDialog("rollback");
    await screen.findByText("3 files");
    await user.click(screen.getByRole("button", { name: "Rollback" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A merge is in progress.");
    expect(store.getState().dialog).toBe("rollback");
  });
});
