import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { defaultDiffSettings } from "../state/store";
import { DiffToolbar } from "./DiffToolbar";

function toolbar(props: Partial<Parameters<typeof DiffToolbar>[0]> = {}) {
  const onDifference = vi.fn();
  const onFile = vi.fn();
  const onSettings = vi.fn();
  render(
    <DiffToolbar
      platform="macos"
      differences={3}
      separatorsOnly={false}
      current={1}
      fileIndex={1}
      fileCount={3}
      onDifference={onDifference}
      onFile={onFile}
      settings={defaultDiffSettings}
      onSettings={onSettings}
      {...props}
    />,
  );
  return { onDifference, onFile, onSettings };
}

it("moves between differences and files", async () => {
  const user = userEvent.setup();
  const { onDifference, onFile } = toolbar();
  expect(screen.getByText("3 differences")).toBeInTheDocument();
  expect(screen.getByText("2/3 files")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next Difference F7" }));
  await user.click(screen.getByRole("button", { name: "Previous Difference ⇧F7" }));
  await user.click(screen.getByRole("button", { name: "Compare Next File" }));
  expect(onDifference.mock.calls).toEqual([[2], [0]]);
  expect(onFile).toHaveBeenCalledWith(1);
});

it("disables moves past the ends and says when only line separators differ", () => {
  toolbar({ differences: 0, current: -1, fileIndex: 0, fileCount: 1, separatorsOnly: true });
  expect(screen.getByText("Only line separators differ")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next Difference F7" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Compare Previous File" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Compare Next File" })).toBeDisabled();
});

it("switches the viewer, folding and settings", async () => {
  const user = userEvent.setup();
  const { onSettings } = toolbar();
  await user.click(screen.getByRole("button", { name: "Unified viewer" }));
  await user.click(screen.getByRole("button", { name: "Collapse Unchanged Fragments" }));
  await user.click(screen.getByRole("button", { name: "Diff settings" }));
  await user.click(screen.getByRole("menuitem", { name: "Ignore whitespaces" }));
  expect(onSettings.mock.calls).toEqual([
    [{ viewer: "unified" }],
    [{ collapseUnchanged: false }],
    [{ whitespace: "ignore" }],
  ]);
  expect(screen.queryByRole("menu", { name: "Diff settings" })).toBeNull();
});
