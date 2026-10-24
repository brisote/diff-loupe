import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeCore, renderWithStore } from "../test/render";
import { UninstallDialog } from "./UninstallDialog";

const locations = [
  "~/Library/Application Support/com.diffloupe.app",
  "~/Library/Caches/com.diffloupe.app",
];

describe("UninstallDialog", () => {
  it("lists the files it deletes and uninstalls on request", async () => {
    const transport = fakeCore();
    transport.removable = locations;
    await renderWithStore(<UninstallDialog />, transport);
    const list = await screen.findByRole("list", { name: "Files to delete" });
    expect(list.textContent).toContain(locations[0]);
    expect(list.textContent).toContain(locations[1]);
    await userEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    expect(transport.uninstalled).toBe(true);
    expect(screen.getByRole("button", { name: "Uninstalling…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("shows why it failed and lets the user try again", async () => {
    const transport = fakeCore();
    transport.removable = locations;
    transport.uninstallError = "Diffloupe could not delete ~/Library/Caches/com.diffloupe.app";
    await renderWithStore(<UninstallDialog />, transport);
    await userEvent.click(await screen.findByRole("button", { name: "Uninstall" }));
    expect((await screen.findByRole("alert")).textContent).toContain("could not delete");
    expect(transport.uninstalled).toBe(false);
    expect(screen.getByRole("button", { name: "Uninstall" })).toBeEnabled();
  });

  it("lets the user try again when the list of files could not be read", async () => {
    const transport = fakeCore();
    transport.uninstallInfoError = "no home folder";
    await renderWithStore(<UninstallDialog />, transport);
    expect((await screen.findByRole("alert")).textContent).toContain("no home folder");
    await userEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    expect(transport.uninstalled).toBe(true);
  });
});
