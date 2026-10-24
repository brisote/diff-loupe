import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { FileChange, MergeState } from "../api";
import { CommitDialog } from "../dialogs/CommitDialog";
import { operationLabel } from "../main-window/StatusBar";
import { fakeCore, renderWithStore, repoInfo } from "../test/render";
import { AbortMergeDialog, ConflictsDialog, nextSelection } from "./ConflictsDialog";
import { MergeBanner } from "./MergeBanner";
import { MergeHost } from "./MergeHost";

const change = (path: string, kind: FileChange["kind"]): FileChange => ({
  path,
  oldPath: null,
  headPath: null,
  kind,
  staged: false,
  unstaged: true,
  unchanged: false,
});

const conflicted: MergeState = {
  operation: "merge",
  theirs: "main",
  message: "Merge branch 'main' into gs/x",
  conflicts: [
    { path: "src/Invoice.kt", ours: "modified", theirs: "modified" },
    { path: "legacy.yaml", ours: "deleted", theirs: "modified" },
  ],
};

function core(state: () => MergeState, changes: () => FileChange[], calls: unknown[] = []) {
  return fakeCore({
    current_repo: () => repoInfo("acme-billing", "gs/x"),
    status: changes,
    merge_state: state,
    accept_side: (args) => {
      calls.push(["accept_side", args]);
      return null;
    },
    abort_merge: (args) => {
      calls.push(["abort_merge", args]);
      return null;
    },
    commit: (args) => {
      calls.push(["commit", args]);
      return { id: "abc", short: "abc" };
    },
  });
}

describe("merge helpers", () => {
  it("selects one file or extends the selection in list order", () => {
    const paths = ["a", "b", "c"];
    expect(nextSelection(paths, ["a"], "b", false)).toEqual(["b"]);
    expect(nextSelection(paths, ["c"], "a", true)).toEqual(["a", "c"]);
    expect(nextSelection(paths, ["a", "c"], "a", true)).toEqual(["c"]);
  });

  it("names the operation for the status bar", () => {
    expect(operationLabel(conflicted)).toBe("Merging main");
    expect(operationLabel({ ...conflicted, operation: "rebase" })).toBe("Rebasing");
    expect(operationLabel({ ...conflicted, theirs: null })).toBe("Merging");
  });
});

describe("MergeBanner", () => {
  it("counts conflicts and opens the dialogs", async () => {
    const user = userEvent.setup();
    const { store } = await renderWithStore(
      <MergeBanner />,
      core(
        () => conflicted,
        () => [change("src/Invoice.kt", "conflicted")],
      ),
    );
    await act(() => store.getState().loadStatus());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Merging main into gs/x: 2 files have conflicts.",
    );
    await user.click(screen.getByRole("button", { name: "Resolve" }));
    expect(store.getState().dialog).toBe("conflicts");
    await user.click(screen.getByRole("button", { name: "Abort merge" }));
    expect(store.getState().dialog).toBe("abortMerge");
  });

  it("offers to commit once every conflict is resolved, and opens the commit dialog", async () => {
    const user = userEvent.setup();
    const { store } = await renderWithStore(
      <MergeBanner />,
      core(
        () => ({ ...conflicted, conflicts: [] }),
        () => [],
      ),
    );
    await act(() => store.getState().loadStatus());
    expect(screen.getByRole("status")).toHaveTextContent(
      "All conflicts are resolved. Commit the merge to finish it.",
    );
    await user.click(screen.getByRole("button", { name: "Commit merge" }));
    expect(store.getState().dialog).toBe("commit");
  });

  it("sends a rebase to the terminal", async () => {
    const { store } = await renderWithStore(
      <MergeBanner />,
      core(
        () => ({ ...conflicted, operation: "rebase", theirs: null, message: null }),
        () => [],
      ),
    );
    await act(() => store.getState().loadStatus());
    expect(screen.getByRole("status")).toHaveTextContent("A rebase is in progress.");
    expect(screen.getByRole("button", { name: "Open Terminal" })).toBeInTheDocument();
  });

  it("opens the Conflicts dialog instead of committing while conflicts remain", async () => {
    const { store } = await renderWithStore(
      <MergeBanner />,
      core(
        () => conflicted,
        () => [],
      ),
    );
    await act(() => store.getState().loadStatus());
    act(() => store.getState().showDialog("commit"));
    expect(store.getState().dialog).toBe("conflicts");
  });
});

describe("ConflictsDialog", () => {
  it("lists each side and accepts the selected files", async () => {
    const user = userEvent.setup();
    let state = conflicted;
    const calls: unknown[] = [];
    const { store } = await renderWithStore(
      <ConflictsDialog />,
      core(
        () => state,
        () => [],
        calls,
      ),
    );
    await act(() => store.getState().loadStatus());
    act(() => store.getState().showDialog("conflicts"));
    expect(screen.getByText(/stopped on 2 files/)).toBeInTheDocument();
    const legacy = screen.getByRole("option", { name: "legacy.yaml" });
    expect(legacy).toHaveTextContent("DeletedModified");
    expect(
      screen.getAllByRole("option").map((option) => option.getAttribute("aria-label")),
    ).toEqual(["legacy.yaml", "src/Invoice.kt"]);
    expect(legacy).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("option", { name: "src/Invoice.kt" }));
    expect(legacy).toHaveAttribute("aria-selected", "false");
    await user.click(legacy);
    expect(legacy).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Meta>}");
    await user.click(legacy);
    await user.keyboard("{/Meta}");
    expect(screen.queryAllByRole("option", { selected: true })).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Accept Theirs" })).toBeDisabled();
    await user.click(legacy);
    state = { ...conflicted, conflicts: conflicted.conflicts.slice(0, 1) };
    await user.click(screen.getByRole("button", { name: "Accept Theirs" }));
    expect(calls).toEqual([
      [
        "accept_side",
        { path: "/Users/ada/Workspace/acme-billing", files: ["legacy.yaml"], side: "theirs" },
      ],
    ]);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Merge…" }));
    expect(store.getState()).toMatchObject({ dialog: "merge", mergeFile: "src/Invoice.kt" });
    act(() => store.getState().showDialog("conflicts"));
    state = { ...conflicted, conflicts: [] };
    await user.click(screen.getByRole("button", { name: "Accept Yours" }));
    expect(store.getState().dialog).toBeNull();
  });

  it("shows why accepting a side failed and lets the user try again", async () => {
    const user = userEvent.setup();
    const { store } = await renderWithStore(
      <ConflictsDialog />,
      fakeCore({
        current_repo: () => repoInfo("acme-billing", "gs/x"),
        status: () => [],
        merge_state: () => conflicted,
        accept_side: () => {
          throw { code: "git", message: "Another git process seems to be running.", path: null };
        },
      }),
    );
    await act(() => store.getState().loadStatus());
    act(() => store.getState().showDialog("conflicts"));
    await user.click(screen.getByRole("button", { name: "Accept Yours" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Another git process seems to be running.",
    );
    expect(screen.getByRole("button", { name: "Accept Yours" })).toBeEnabled();
    expect(store.getState().dialog).toBe("conflicts");
  });

  it("stays closed during a rebase, whose sides git swaps", async () => {
    const { store } = await renderWithStore(
      <ConflictsDialog />,
      core(
        () => ({ ...conflicted, operation: "rebase", theirs: null, message: null }),
        () => [],
      ),
    );
    await act(() => store.getState().loadStatus());
    act(() => store.getState().showDialog("commit"));
    expect(store.getState().dialog).toBe("commit");
    expect(screen.queryByRole("dialog", { name: "Conflicts" })).toBeNull();
  });

  it("asks before it aborts the merge", async () => {
    const user = userEvent.setup();
    const calls: unknown[] = [];
    const { store } = await renderWithStore(
      <AbortMergeDialog />,
      core(
        () => conflicted,
        () => [],
        calls,
      ),
    );
    await act(() => store.getState().loadStatus());
    act(() => store.getState().showDialog("abortMerge"));
    expect(screen.getByRole("dialog", { name: "Abort Merge" })).toHaveTextContent(
      "Abort the merge of main into gs/x?",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(store.getState().dialog).toBeNull();
    act(() => store.getState().showDialog("abortMerge"));
    await user.click(screen.getByRole("button", { name: "Abort Merge" }));
    expect(calls).toEqual([["abort_merge", { path: "/Users/ada/Workspace/acme-billing" }]]);
    expect(store.getState().dialog).toBeNull();
  });
});

describe("Commit Merge", () => {
  it("fills git's message, lists merged files and commits every one", async () => {
    const user = userEvent.setup();
    const calls: unknown[] = [];
    const { store } = await renderWithStore(
      <CommitDialog />,
      core(
        () => ({ ...conflicted, conflicts: [] }),
        () => [
          { ...change("src/Invoice.kt", "modified"), staged: true },
          change("src/local.kt", "modified"),
          change("notes.md", "untracked"),
        ],
        calls,
      ),
    );
    await act(() => store.getState().loadStatus());
    act(() => store.getState().showDialog("commit"));
    expect(screen.getByText("Commit Merge", { selector: ".dl-dialog-title" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Commit message" })).toHaveValue(
      "Merge branch 'main' into gs/x",
    );
    expect(screen.getByRole("region", { name: "Merged files" })).toHaveTextContent("1 file");
    expect(screen.queryByRole("checkbox", { name: "Amend" })).toBeNull();
    expect(screen.getByText(/Amend is not available/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Commit" }));
    expect(calls).toContainEqual([
      "commit",
      {
        path: "/Users/ada/Workspace/acme-billing",
        message: "Merge branch 'main' into gs/x",
        amend: false,
        files: [],
        staged: [],
      },
    ]);
  });
});

describe("MergeHost", () => {
  it("never shows the merge of the previous file while the next one loads", async () => {
    const binary = (path: string) => ({
      path,
      content: "binary" as const,
      base: "",
      ours: "",
      theirs: "",
      crlf: false,
      chunks: [],
    });
    const transport = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/x"),
      merge_file: (args) => {
        const file = (args as { file: string }).file;
        return file === "A.bin" ? binary(file) : new Promise(() => undefined);
      },
    });
    function Host() {
      const [file, setFile] = useState("A.bin");
      return (
        <>
          <button type="button" onClick={() => setFile("B.bin")}>
            Next
          </button>
          <MergeHost file={file} embedded={false} onDone={() => undefined} />
        </>
      );
    }
    await renderWithStore(<Host />, transport);
    expect(await screen.findByText("A.bin is a binary file")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByText(/is a binary file/)).toBeNull();
    expect(screen.getByText("Preparing the merge")).toBeInTheDocument();
  });
});
