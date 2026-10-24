import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FileChange } from "../api";
import { fakeCore, renderWithStore, repoInfo } from "../test/render";
import { ChangesView } from "./ChangesView";

function change(path: string, kind: FileChange["kind"]): FileChange {
  return {
    path,
    oldPath: kind === "renamed" ? "old/Name.kt" : null,
    headPath: kind === "renamed" ? "old/Name.kt" : null,
    kind,
    staged: false,
    unstaged: true,
    unchanged: false,
  };
}

const changes = [
  change("billing/src/InvoiceExporter.kt", "modified"),
  change("web/src/exportButton.tsx", "added"),
  change("billing/Name.kt", "renamed"),
  change("docs/export-notes.md", "untracked"),
];

async function view(files: FileChange[] = changes, selection: string | null = null) {
  const core = fakeCore({
    current_repo: () => ({
      ...repoInfo("acme-billing", "gs/invoice-export"),
      lastSelection: selection,
    }),
    status: () => files,
  });
  const rendered = await renderWithStore(<ChangesView />, core);
  await screen.findByRole("tree", { name: "Changed files" }).catch(() => undefined);
  return { ...rendered, core };
}

describe("ChangesView", () => {
  it("keeps one row per group when a path is both deleted and untracked", async () => {
    const { store } = await view([change("notes.md", "deleted"), change("notes.md", "untracked")]);
    expect(screen.getAllByRole("treeitem", { name: "notes.md" })).toHaveLength(2);
    act(() => store.setState({ changes: [change("b.txt", "modified")] }));
    expect(screen.queryAllByRole("treeitem", { name: "notes.md" })).toHaveLength(0);
  });

  it("shows groups and files with icons, names, folders and status colours", async () => {
    await view();
    const tree = screen.getByRole("tree", { name: "Changed files" });
    const group = within(tree).getByRole("treeitem", { name: /Changes/ });
    expect(group).toHaveTextContent("3 files");
    const row = within(tree).getByRole("treeitem", { name: "billing/src/InvoiceExporter.kt" });
    expect(row.querySelector(".dl-ft-kotlin")).not.toBeNull();
    expect(row.querySelector(".dl-row-name")).toHaveClass("st-modified");
    expect(row).toHaveTextContent("billing/src");
    expect(within(tree).getByRole("treeitem", { name: "billing/Name.kt" })).toHaveAttribute(
      "title",
      "Renamed from old/Name.kt",
    );
    expect(within(tree).getByRole("treeitem", { name: /Unversioned Files/ })).toHaveTextContent(
      "1 file",
    );
  });

  it("selects a file by click and remembers it for the repository", async () => {
    const user = userEvent.setup();
    const { core, store } = await view();
    await user.click(screen.getByRole("treeitem", { name: "web/src/exportButton.tsx" }));
    expect(store.getState().repo?.lastSelection).toBe("web/src/exportButton.tsx");
    expect(core.calls.at(-1)).toEqual({
      cmd: "set_repo_view",
      args: {
        path: "/Users/ada/Workspace/acme-billing",
        tab: "changes",
        selection: "web/src/exportButton.tsx",
      },
    });
    expect(screen.getByRole("treeitem", { name: "web/src/exportButton.tsx" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("moves the selection with the arrow keys", async () => {
    const user = userEvent.setup();
    const { store } = await view(changes, "billing/Name.kt");
    screen.getByRole("tree", { name: "Changed files" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(store.getState().repo?.lastSelection).toBe("billing/src/InvoiceExporter.kt");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(store.getState().repo?.lastSelection).toBe("billing/Name.kt");
  });

  it("folds a group by its header", async () => {
    const user = userEvent.setup();
    await view();
    await user.click(screen.getByRole("treeitem", { name: /Unversioned Files/ }));
    expect(screen.queryByRole("treeitem", { name: "docs/export-notes.md" })).toBeNull();
    expect(screen.getByRole("treeitem", { name: "web/src/exportButton.tsx" })).toBeInTheDocument();
    await user.click(screen.getByRole("treeitem", { name: /Unversioned Files/ }));
    expect(screen.getByRole("treeitem", { name: "docs/export-notes.md" })).toBeInTheDocument();
  });

  it("keeps only Refresh, Commit and Rollback in the toolbar", async () => {
    await view();
    const toolbar = screen.getByRole("toolbar", { name: "Changes actions" });
    expect(
      within(toolbar)
        .getAllByRole("button")
        .map((button) => button.title),
    ).toEqual(["Refresh", "Commit… ⌘K", "Rollback…"]);
  });

  it("says when the working tree has no changes", async () => {
    await view([]);
    expect(screen.getByText("No changes")).toBeInTheDocument();
    expect(
      screen.getByText("The working tree matches main. Committed work is in the Branch log."),
    ).toBeInTheDocument();
  });

  it("refreshes on request and shows a status error", async () => {
    const user = userEvent.setup();
    let fail = false;
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing"),
      status: () => {
        if (fail) throw { code: "git", message: "git failed: index is locked", path: null };
        return changes;
      },
    });
    await renderWithStore(<ChangesView />, core);
    fail = true;
    await act(async () => user.click(screen.getByRole("button", { name: "Refresh" })));
    expect(await screen.findByRole("alert")).toHaveTextContent("git failed: index is locked");
  });

  it("measures the time from opening to the first list", async () => {
    performance.clearMeasures("open-to-changes");
    const core = fakeCore({
      open_repo: () => repoInfo("acme-billing"),
      status: () => changes,
    });
    const { store } = await renderWithStore(<ChangesView />, core);
    expect(performance.getEntriesByName("open-to-changes")).toHaveLength(0);
    await store.getState().open("/Users/ada/Workspace/acme-billing");
    await vi.waitFor(() => expect(performance.getEntriesByName("open-to-changes")).toHaveLength(1));
  });

  it("keeps keyboard focus on the tree after a click", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 80 }, (_, i) =>
      change(`src/file-${String(i).padStart(2, "0")}.ts`, "modified"),
    );
    const { store } = await view(many);
    await user.click(screen.getByRole("treeitem", { name: "src/file-00.ts" }));
    const tree = screen.getByRole("tree", { name: "Changed files" });
    expect(tree).toHaveFocus();
    for (let i = 0; i < 50; i += 1) await user.keyboard("{ArrowDown}");
    expect(store.getState().repo?.lastSelection).toBe("src/file-50.ts");
    expect(tree).toHaveFocus();
  });

  it("names a nested repository by its folder", async () => {
    await view([change("vendor/lib/", "untracked")]);
    const row = screen.getByRole("treeitem", { name: "vendor/lib/" });
    expect(row.querySelector(".dl-row-name")).toHaveTextContent("lib");
    expect(row.querySelector(".dl-i-nodes-folder")).not.toBeNull();
  });
});
