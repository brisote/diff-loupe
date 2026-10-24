import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeCore, recent, renderWithStore, repoInfo } from "../test/render";
import { MainToolbar } from "./MainToolbar";

function core() {
  return fakeCore({
    current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
    recent_repos: () => [recent("acme-billing", "gs/invoice-export"), recent("payments-api")],
    open_repo: (args) => repoInfo((args as { path: string }).path.split("/").at(-1) ?? ""),
  });
}

describe("MainToolbar", () => {
  it("shows the project and the current branch", async () => {
    await renderWithStore(<MainToolbar />, core());
    expect(screen.getByRole("button", { name: "Recent projects" })).toHaveTextContent(
      "acme-billing",
    );
    expect(screen.getByRole("button", { name: "Current branch" })).toHaveTextContent(
      "gs/invoice-export",
    );
  });

  it("lets every empty part of the toolbar move and zoom the window", async () => {
    await renderWithStore(<MainToolbar />, core());
    const toolbar = screen.getByRole("banner");
    expect(toolbar).toHaveAttribute("data-tauri-drag-region", "deep");
    await userEvent.setup().click(screen.getByRole("button", { name: "Recent projects" }));
    expect(screen.getByRole("dialog", { name: "Recent projects" })).toHaveAttribute(
      "data-tauri-drag-region",
      "false",
    );
  });

  it("switches to another recent project", async () => {
    const user = userEvent.setup();
    const { store } = await renderWithStore(<MainToolbar />, core());
    await user.click(screen.getByRole("button", { name: "Recent projects" }));
    const popup = screen.getByRole("dialog", { name: "Recent projects" });
    expect(within(popup).getByRole("option", { name: "acme-billing" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(within(popup).getByRole("option", { name: "payments-api" }));
    expect(screen.queryByRole("dialog", { name: "Recent projects" })).toBeNull();
    expect(store.getState().repo?.name).toBe("payments-api");
  });

  it("does not reopen the current project", async () => {
    const user = userEvent.setup();
    const transport = core();
    await renderWithStore(<MainToolbar />, transport);
    await user.click(screen.getByRole("button", { name: "Recent projects" }));
    await user.click(screen.getByRole("option", { name: "acme-billing" }));
    expect(transport.calls.map((c) => c.cmd)).not.toContain("open_repo");
  });

  it("opens a folder from the popup footer", async () => {
    const user = userEvent.setup();
    const transport = core();
    transport.picked = "/Users/ada/Workspace/tax-rules";
    const { store } = await renderWithStore(<MainToolbar />, transport);
    await user.click(screen.getByRole("button", { name: "Recent projects" }));
    await user.click(screen.getByRole("button", { name: "Open folder" }));
    await screen.findByText("tax-rules");
    expect(store.getState().repo?.name).toBe("tax-rules");
  });

  it("opens dialogs from the settings menu and closes it with Escape", async () => {
    const user = userEvent.setup();
    const { store } = await renderWithStore(<MainToolbar />, core());
    await user.click(screen.getByRole("button", { name: "Settings menu" }));
    const menu = screen.getByRole("menu", { name: "Settings menu" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Settings…⌘,",
      "Check for updates…",
      "Star on GitHub",
      "About Diffloupe",
      "Uninstall Diffloupe…",
    ]);
    await user.click(within(menu).getByRole("menuitem", { name: "About Diffloupe" }));
    expect(store.getState().dialog).toBe("about");
    await user.click(screen.getByRole("button", { name: "Settings menu" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes its popup when the same button is clicked again", async () => {
    const user = userEvent.setup();
    await renderWithStore(<MainToolbar />, core());
    const button = screen.getByRole("button", { name: "Recent projects" });
    await user.click(button);
    expect(screen.getByRole("dialog", { name: "Recent projects" })).toBeInTheDocument();
    await new Promise((done) => setTimeout(done));
    await user.click(button);
    expect(screen.queryByRole("dialog", { name: "Recent projects" })).toBeNull();
  });
});
