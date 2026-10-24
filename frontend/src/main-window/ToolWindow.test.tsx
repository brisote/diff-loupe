import { act, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { fakeCore, renderWithStore, repoInfo } from "../test/render";
import { ToolWindow } from "./ToolWindow";

it("names the default branch only when the target is the default branch", async () => {
  const saved = { ...repoInfo("acme-billing"), target: "release/1.4" };
  await renderWithStore(<ToolWindow width={400} />, fakeCore({ current_repo: () => saved }));
  const target = screen.getByRole("button", { name: "Target branch" });
  expect(target).toHaveTextContent("release/1.4");
  expect(target).toHaveAttribute("title", "release/1.4");
});

it("marks the default branch target", async () => {
  await renderWithStore(
    <ToolWindow width={400} />,
    fakeCore({ current_repo: () => repoInfo("acme-billing") }),
  );
  expect(screen.getByRole("button", { name: "Target branch" })).toHaveAttribute(
    "title",
    "main (default branch)",
  );
});

it("shows the target only on the Changes tab", async () => {
  const saved = { ...repoInfo("acme-billing", "gs/invoice-export"), lastTab: "log" as const };
  const { store } = await renderWithStore(
    <ToolWindow width={400} />,
    fakeCore({ current_repo: () => saved }),
  );
  expect(screen.queryByRole("button", { name: "Target branch" })).not.toBeInTheDocument();
  await act(() => store.getState().setTab("changes"));
  expect(screen.getByRole("button", { name: "Target branch" })).toBeInTheDocument();
});
