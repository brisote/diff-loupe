import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeCore, recent, renderWithStore, repoInfo } from "../test/render";
import { Welcome } from "./Welcome";

const recents = [
  recent("gone", "main", false),
  recent("acme-billing", "gs/invoice-export"),
  recent("payments-api"),
];

describe("Welcome", () => {
  it("lists recent repositories with short paths and branches", async () => {
    await renderWithStore(<Welcome />, fakeCore({ recent_repos: () => recents }));
    const list = screen.getByRole("listbox", { name: "Recent repositories" });
    const billing = within(list).getByRole("option", { name: "acme-billing" });
    expect(billing).toHaveTextContent("~/Workspace/acme-billing");
    expect(billing).toHaveTextContent("gs/invoice-export");
    expect(screen.getByText("0.1")).toBeInTheDocument();
    expect(screen.queryByText(/personal build/)).toBeNull();
  });

  it("filters the list by name or path", async () => {
    const user = userEvent.setup();
    await renderWithStore(<Welcome />, fakeCore({ recent_repos: () => recents }));
    await user.type(screen.getByPlaceholderText("Search recent repositories"), "PAY");
    expect(screen.getAllByRole("option", { name: /payments|acme|gone/ })).toHaveLength(1);
  });

  it("opens a recent repository by click or keyboard", async () => {
    const user = userEvent.setup();
    const core = fakeCore({
      recent_repos: () => recents,
      open_repo: () => repoInfo("acme-billing"),
    });
    const { store } = await renderWithStore(<Welcome />, core);
    screen.getByRole("option", { name: "payments-api" }).focus();
    await user.keyboard("{Enter}");
    expect(core.calls.find((call) => call.cmd === "open_repo")).toEqual({
      cmd: "open_repo",
      args: { path: "/Users/ada/Workspace/payments-api" },
    });
    expect(store.getState().repo?.name).toBe("acme-billing");
  });

  it("explains why a plain folder cannot be opened", async () => {
    const user = userEvent.setup();
    const core = fakeCore({
      open_repo: () => {
        throw { code: "notARepository", message: "x" };
      },
    });
    core.picked = "/Users/ada/Downloads/invoices";
    await renderWithStore(<Welcome />, core);
    await user.click(screen.getByRole("button", { name: "Open…" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("~/Downloads/invoices is not a git repository.");
    expect(
      within(alert).getByRole("button", { name: "Choose another folder" }),
    ).toBeInTheDocument();
    expect(within(alert).queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("opens Settings from the side list", async () => {
    const user = userEvent.setup();
    const { store } = await renderWithStore(<Welcome />, fakeCore());
    await user.click(screen.getByRole("option", { name: "Settings" }));
    await act(async () => undefined);
    expect(store.getState().dialog).toBe("settings");
  });
});
