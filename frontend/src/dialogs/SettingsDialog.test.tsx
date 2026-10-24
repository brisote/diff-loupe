import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useApp } from "../state/context";
import { fakeCore, renderWithStore, settings } from "../test/render";
import { SettingsDialog } from "./SettingsDialog";

async function open() {
  const transport = fakeCore();
  const view = await renderWithStore(<SettingsDialog />, transport);
  view.store.getState().showDialog("settings");
  return { ...view, transport };
}

describe("SettingsDialog", () => {
  it("saves diff options with OK and closes", async () => {
    const user = userEvent.setup();
    const { store, transport } = await open();
    await user.selectOptions(screen.getByLabelText("Viewer"), "unified");
    await user.click(screen.getByRole("checkbox", { name: "Collapse unchanged fragments" }));
    await user.click(screen.getByRole("button", { name: "OK" }));
    const saved = transport.calls.find((call) => call.cmd === "set_settings")?.args as {
      settings: { diff: { viewer: string; collapseUnchanged: boolean } };
    };
    expect(saved.settings.diff.viewer).toBe("unified");
    expect(saved.settings.diff.collapseUnchanged).toBe(false);
    expect(store.getState().dialog).toBeNull();
  });

  it("has the Diff and Updates sections", async () => {
    await open();
    expect(
      screen
        .getAllByRole("option")
        .filter((option) => option.closest('[aria-label="Settings sections"]'))
        .map((option) => option.textContent),
    ).toEqual(["Diff", "Updates"]);
    expect(screen.queryByText(/AI agent|claude/i)).toBeNull();
  });

  it("drops changes on Cancel", async () => {
    const user = userEvent.setup();
    const { transport, store } = await open();
    await user.selectOptions(screen.getByLabelText("Highlighting"), "none");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(transport.calls.map((call) => call.cmd)).not.toContain("set_settings");
    expect(store.getState().settings?.diff.highlight).toBe("words");
  });

  it("shows why saving failed and stays open", async () => {
    const user = userEvent.setup();
    const transport = fakeCore({
      set_settings: () => {
        throw { code: "store", message: "storage failed: disk full", path: null };
      },
    });
    const { store } = await renderWithStore(<SettingsDialog />, transport);
    store.getState().showDialog("settings");
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Settings could not be saved. storage failed: disk full",
    );
    expect(store.getState().dialog).toBe("settings");
    expect(store.getState().settings).toEqual(settings);
  });
});

describe("the Updates section", () => {
  const page = "https://github.com/brisote/diff-loupe/releases/tag/v0.3.0";

  function Shown() {
    const dialog = useApp((state) => state.dialog);
    return dialog === "settings" ? <SettingsDialog /> : null;
  }

  async function updates(check: () => unknown) {
    const transport = fakeCore({
      check_update: check,
      download_update: () => ({ version: "0.3.0" }),
    });
    const view = await renderWithStore(<Shown />, transport);
    view.store.getState().openUpdates();
    return { ...view, transport };
  }

  it("opens from Check for updates with a check, and reports the latest version", async () => {
    const { transport } = await updates(() => ({
      current: "0.2.0",
      latest: "0.2.0",
      newer: false,
      page,
    }));
    expect(await screen.findByText("Diffloupe 0.2.0 is the latest version.")).toBeTruthy();
    expect(transport.calls.filter((call) => call.cmd === "check_update")).toHaveLength(1);
  });

  it("offers a newer version with an Update button", async () => {
    const user = userEvent.setup();
    const { transport } = await updates(() => ({
      current: "0.2.0",
      latest: "0.3.0",
      newer: true,
      page,
    }));
    expect(await screen.findByText("Diffloupe 0.3.0 is available.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Update" }));
    expect(transport.calls.some((call) => call.cmd === "download_update")).toBe(true);
    expect(await screen.findByText("Diffloupe 0.3.0 is ready.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Restart now" }));
    expect(transport.installed).toBe(true);
  });

  it("says when GitHub could not be reached, and checks again on Check now", async () => {
    const user = userEvent.setup();
    let answers = 0;
    await updates(() => {
      answers++;
      throw {
        code: "update",
        message: "GitHub could not be reached. Check the connection and try again.",
      };
    });
    expect(
      await screen.findByText("GitHub could not be reached. Check the connection and try again."),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Check now" }));
    expect(answers).toBe(2);
  });

  it("saves the automatic check setting", async () => {
    const user = userEvent.setup();
    const { transport } = await updates(() => ({
      current: "0.2.0",
      latest: "0.2.0",
      newer: false,
      page,
    }));
    await user.click(
      screen.getByRole("checkbox", { name: "Check for new versions automatically" }),
    );
    await user.click(screen.getByRole("button", { name: "OK" }));
    const saved = transport.calls.find((call) => call.cmd === "set_settings")?.args as {
      settings: { updates: { check: boolean } };
    };
    expect(saved.settings.updates.check).toBe(true);
  });
});
