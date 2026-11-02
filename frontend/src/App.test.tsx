import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { App } from "./App";
import { fakeCore, renderWithStore, repoInfo } from "./test/render";

it("opens diff search on mod+f and closes on escape", async () => {
  const user = userEvent.setup();
  const core = fakeCore({
    current_repo: () => ({
      ...repoInfo("acme-billing", "gs/invoice-export"),
      lastSelection: "src/main.rs",
    }),
    status: () => [
      {
        path: "src/main.rs",
        oldPath: null,
        headPath: null,
        kind: "modified",
        staged: false,
        unstaged: true,
        unchanged: false,
      },
    ],
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

  const { container, store } = await renderWithStore(<App />, core);
  await screen.findByText("Current version");

  expect(store.getState().searchOpen).toBe(false);
  expect(container.querySelector(".dl-diff-search")).not.toBeInTheDocument();

  await user.keyboard("{Meta>}f{/Meta}");
  await waitFor(() => expect(store.getState().searchOpen).toBe(true));
  await waitFor(() => expect(container.querySelector(".dl-diff-search")).toBeInTheDocument());

  await user.keyboard("{Escape}");
  await waitFor(() => expect(store.getState().searchOpen).toBe(false));
  await waitFor(() => expect(container.querySelector(".dl-diff-search")).not.toBeInTheDocument());
});
