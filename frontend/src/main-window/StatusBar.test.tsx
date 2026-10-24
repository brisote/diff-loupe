import { act, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { fakeCore, renderWithStore, repoInfo } from "../test/render";
import { StatusBar } from "./StatusBar";

it("shows running tasks with their progress and hides finished ones", async () => {
  const core = fakeCore({ current_repo: () => repoInfo("acme-billing", "gs/invoice-export") });
  await renderWithStore(<StatusBar />, core);
  expect(screen.getByRole("contentinfo")).toHaveTextContent("acme-billing");
  expect(screen.getByRole("contentinfo")).toHaveTextContent("gs/invoice-export");

  act(() =>
    core.emit({
      type: "task",
      id: "open",
      label: "Opening acme-billing · reading changes",
      progress: 0.2,
      done: false,
      cancellable: false,
    }),
  );
  const bar = screen.getByRole("progressbar", { name: "Opening acme-billing · reading changes" });
  expect(bar).toHaveAttribute("aria-valuenow", "20");

  act(() =>
    core.emit({
      type: "task",
      id: "log",
      label: "Reading the branch log",
      progress: null,
      done: false,
      cancellable: false,
    }),
  );
  expect(screen.getByRole("progressbar", { name: "Reading the branch log" })).toHaveClass(
    "is-indeterminate",
  );

  act(() =>
    core.emit({
      type: "task",
      id: "open",
      label: "done",
      progress: 1,
      done: true,
      cancellable: false,
    }),
  );
  expect(screen.queryByRole("progressbar", { name: /Opening/ })).toBeNull();
});
