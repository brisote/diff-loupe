import { screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import type { FileChange, FileDiff } from "../api";
import { fakeCore, renderWithStore, repoInfo } from "../test/render";
import { Editor, sameText } from "./Editor";
import { StatusBar } from "./StatusBar";

const readme: FileChange = {
  path: "docs/guide/README.md",
  oldPath: null,
  headPath: null,
  kind: "modified",
  staged: false,
  unstaged: true,
  unchanged: false,
};
const notes: FileChange = {
  path: "notes.txt",
  oldPath: null,
  headPath: null,
  kind: "untracked",
  staged: false,
  unstaged: true,
  unchanged: false,
};

async function show(changes: FileChange[], selection: string | null) {
  const core = fakeCore({
    current_repo: () => ({
      ...repoInfo("acme-billing", "gs/invoice-export"),
      lastSelection: selection,
    }),
    status: () => changes,
    diff: () => new Promise(() => undefined),
  });
  const view = await renderWithStore(
    <>
      <Editor />
      <StatusBar />
    </>,
    core,
  );
  await screen.findByText(/^(No changes|1 change|[0-9]+ changes)$/);
  return view;
}

it("asks for a file when changes exist but none is selected", async () => {
  await show([readme], null);
  expect(screen.getByText("Select a file to see its changes")).toBeInTheDocument();
  expect(screen.getByRole("contentinfo")).toHaveTextContent("1 change");
});

it("names the selected file and shows its location in the status bar", async () => {
  await show([readme, notes], "docs/guide/README.md");
  expect(screen.getByText("README.md shows here as soon as it is ready.")).toBeInTheDocument();
  expect(screen.getByRole("contentinfo")).toHaveTextContent(
    "acme-billing › docs › guide › README.md",
  );
  expect(screen.getByRole("contentinfo")).toHaveTextContent("1 change");
});

it("has nothing to compare in a clean working tree", async () => {
  await show([], "gone.txt");
  expect(screen.getByText("Nothing to compare")).toBeInTheDocument();
  expect(screen.getByRole("contentinfo")).toHaveTextContent("No changes");
});

it("tells the user to refresh by hand when the folder cannot be watched", async () => {
  const core = fakeCore({
    current_repo: () => ({ ...repoInfo("acme-billing"), watchError: "too many open files" }),
  });
  await renderWithStore(<StatusBar />, core);
  const item = await screen.findByText("Refresh by hand");
  expect(item).toHaveAttribute("title", "Diffloupe cannot watch this folder: too many open files");
});

const text = (value: string, exists = true) => ({
  text: value,
  exists,
  crlf: false,
  encoding: "UTF-8",
  revision: "a1b2c3d4",
  title: null,
});

it("shows the tab, the file counter and a no-diff state, and closes the tab", async () => {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();
  const logo: FileChange = {
    path: "img/logo.png",
    oldPath: null,
    headPath: null,
    kind: "modified",
    staged: false,
    unstaged: true,
    unchanged: false,
  };
  const core = fakeCore({
    current_repo: () => ({ ...repoInfo("acme-billing"), lastSelection: "img/logo.png" }),
    status: () => [readme, logo],
    diff: () => ({
      path: "img/logo.png",
      oldPath: null,
      headPath: null,
      content: "image",
      left: text("", true),
      right: text("", true),
      blocks: [],
    }),
  });
  const { store } = await renderWithStore(<Editor />, core);
  expect(await screen.findByText("No visual diff for this file type")).toBeInTheDocument();
  expect(
    screen.getByText("logo.png is an image. Diffloupe compares text files only."),
  ).toBeInTheDocument();
  expect(screen.getByText("2/2 files")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Close tab" }));
  expect(store.getState().repo?.lastSelection).toBeNull();
});

it("explains how to resolve a conflicted file instead of showing a diff", async () => {
  const conflict: FileChange = {
    path: "both.txt",
    oldPath: null,
    headPath: null,
    kind: "conflicted",
    staged: false,
    unstaged: true,
    unchanged: false,
  };
  await show([conflict], "both.txt");
  expect(screen.getByText("both.txt has conflicts")).toBeInTheDocument();
  expect(screen.queryByText("Preparing the diff")).toBeNull();
});

it("explains a text diff that has no differences", () => {
  const side = (text: string) => ({
    text,
    exists: true,
    crlf: false,
    encoding: "UTF-8",
    revision: null,
    title: null,
  });
  const diff = (left: string, right: string, oldPath: string | null): FileDiff => ({
    path: "docs/naming.md",
    oldPath,
    content: "text",
    left: side(left),
    right: side(right),
    blocks: [],
  });
  expect(sameText(diff("a\n", "a\n", "standards/naming.md"), "renamed")).toBe(
    "Moved from standards/naming.md. The contents are identical.",
  );
  expect(sameText(diff("a\n", "a\n", "standards/naming.md"), "copied")).toBe(
    "Copied from standards/naming.md. The contents are identical.",
  );
  expect(sameText(diff("a\n", "a\n", null), "modified")).toBe("The contents are identical.");
  expect(sameText(diff("a \n", "a\n", "docs/naming.md"), "modified")).toBe(
    "Only whitespace differs, and the diff settings ignore it.",
  );
  expect(
    sameText({ ...diff("a\n", "a\n", null), right: { ...side("a\n"), crlf: true } }, "modified"),
  ).toBe("Only the line endings changed, from LF to CRLF.");
  expect(
    sameText(
      { ...diff("é\n", "é\n", null), left: { ...side("é\n"), encoding: "ISO-8859-1" } },
      "modified",
    ),
  ).toBe("Only the encoding changed, from ISO-8859-1 to UTF-8.");
  expect(
    sameText({ ...diff("", "a\n", null), left: { ...side(""), exists: false } }, "added"),
  ).toBeNull();
});

it("renders diff search bar when search is open", async () => {
  const codeFile: FileChange = {
    path: "src/main.rs",
    oldPath: null,
    headPath: null,
    kind: "modified",
    staged: false,
    unstaged: true,
    unchanged: false,
  };
  const core = fakeCore({
    current_repo: () => ({
      ...repoInfo("acme-billing", "gs/invoice-export"),
      lastSelection: "src/main.rs",
    }),
    status: () => [codeFile],
    diff: () => ({
      path: "src/main.rs",
      oldPath: null,
      content: "text",
      left: {
        exists: true,
        text: "fn old() {}\n",
        crlf: false,
        encoding: "UTF-8",
        revision: null,
        title: null,
      },
      right: {
        exists: true,
        text: "fn new() {}\n",
        crlf: false,
        encoding: "UTF-8",
        revision: null,
        title: null,
      },
      blocks: [],
    }),
  });
  const { container, store } = await renderWithStore(
    <>
      <Editor />
      <StatusBar />
    </>,
    core,
  );
  await screen.findByText("1 change");
  await screen.findByText("Current version");
  expect(container.querySelector(".dl-diff-search")).not.toBeInTheDocument();
  store.getState().openSearch();
  await waitFor(() => expect(container.querySelector(".dl-diff-search")).toBeInTheDocument());
  store.getState().closeSearch();
  await waitFor(() => expect(container.querySelector(".dl-diff-search")).not.toBeInTheDocument());
});
