import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeCore, renderWithStore } from "../test/render";
import { UninstallDialog } from "./UninstallDialog";

describe("UninstallDialog", () => {
  it("lists no files and uninstalls on request", async () => {
    const transport = fakeCore();
    await renderWithStore(<UninstallDialog />, transport);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText(/deletes Diffloupe's own files/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    expect(transport.uninstalled).toBe(true);
    expect(screen.getByRole("button", { name: "Uninstalling…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("shows why it failed and lets the user try again", async () => {
    const transport = fakeCore();
    transport.uninstallError = "Diffloupe could not delete ~/Library/Caches/com.diffloupe.app";
    await renderWithStore(<UninstallDialog />, transport);
    await userEvent.click(await screen.findByRole("button", { name: "Uninstall" }));
    expect((await screen.findByRole("alert")).textContent).toContain("could not delete");
    expect(transport.uninstalled).toBe(false);
    expect(screen.getByRole("button", { name: "Uninstall" })).toBeEnabled();
  });
});
