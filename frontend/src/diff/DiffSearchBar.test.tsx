import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DiffSearchBar } from "./DiffSearchBar";

function searchBar(props: Partial<Parameters<typeof DiffSearchBar>[0]> = {}) {
  const onQueryChange = vi.fn();
  const onPrevious = vi.fn();
  const onNext = vi.fn();
  const onToggleCase = vi.fn();
  const onClose = vi.fn();
  render(
    <DiffSearchBar
      query="Invoice"
      match={{ current: 2, total: 5 }}
      caseSensitive={false}
      onQueryChange={onQueryChange}
      onPrevious={onPrevious}
      onNext={onNext}
      onToggleCase={onToggleCase}
      onClose={onClose}
      {...props}
    />,
  );
  return { onQueryChange, onPrevious, onNext, onToggleCase, onClose };
}

it("renders search bar with input, count and action buttons", () => {
  searchBar();
  const input = screen.getByRole("textbox", { name: "Search diff" });
  expect(input).toBeInTheDocument();
  expect(input).toHaveValue("Invoice");
  expect(screen.getByText("2 of 5")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous Match ⇧Enter" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Next Match Enter" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Match Case ⌥C" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(screen.getByRole("button", { name: "Close ⎋" })).toBeInTheDocument();
});

it("handles typing and updates search query", async () => {
  const user = userEvent.setup();
  const { onQueryChange } = searchBar({ query: "" });
  const input = screen.getByRole("textbox", { name: "Search diff" });
  await user.type(input, "test");
  expect(onQueryChange).toHaveBeenCalledWith("t");
});

it("navigates matches with enter, shift+enter and buttons", async () => {
  const user = userEvent.setup();
  const { onNext, onPrevious } = searchBar();
  const input = screen.getByRole("textbox", { name: "Search diff" });
  await user.type(input, "{enter}");
  expect(onNext).toHaveBeenCalledTimes(1);
  await user.type(input, "{Shift>}{enter}{/Shift}");
  expect(onPrevious).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Next Match Enter" }));
  expect(onNext).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole("button", { name: "Previous Match ⇧Enter" }));
  expect(onPrevious).toHaveBeenCalledTimes(2);
});

it("closes search on escape key and close button click", async () => {
  const user = userEvent.setup();
  const { onClose } = searchBar();
  const input = screen.getByRole("textbox", { name: "Search diff" });
  await user.type(input, "{escape}");
  expect(onClose).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Close ⎋" }));
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("toggles case sensitivity with alt+c and button click", async () => {
  const user = userEvent.setup();
  const { onToggleCase } = searchBar({ caseSensitive: true });
  expect(screen.getByRole("button", { name: "Match Case ⌥C" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const input = screen.getByRole("textbox", { name: "Search diff" });
  await user.type(input, "{Alt>}c{/Alt}");
  expect(onToggleCase).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Match Case ⌥C" }));
  expect(onToggleCase).toHaveBeenCalledTimes(2);
});

it("shows 0 of 0 in error color and disables navigation when no matches found", () => {
  searchBar({ query: "missing", match: { current: 0, total: 0 } });
  const count = screen.getByText("0 of 0");
  expect(count).toBeInTheDocument();
  expect(count).toHaveClass("is-empty");
  expect(screen.getByRole("button", { name: "Previous Match ⇧Enter" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Next Match Enter" })).toBeDisabled();
});

it("does not display counter when query is empty", () => {
  searchBar({ query: "", match: { current: 0, total: 0 } });
  expect(screen.queryByText("0 of 0")).not.toBeInTheDocument();
});
