import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Platform } from "../api";
import { fakeCore, renderWithStore } from "../test/render";
import { WindowToolbar } from "./WindowToolbar";

async function toolbar(platform: Platform) {
  return renderWithStore(<WindowToolbar />, fakeCore({}, platform));
}

describe("WindowToolbar", () => {
  it("draws the traffic light placeholders on a Mac and nothing for window controls", async () => {
    const { container } = await toolbar("macos");
    expect(container.querySelector(".app-lights")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Minimize" })).toBeNull();
  });

  it("draws no placeholders and no controls on Linux, where the system draws the title bar", async () => {
    const { container } = await toolbar("linux");
    expect(container.querySelector(".app-lights")).toBeNull();
    expect(screen.queryByRole("button", { name: "Minimize" })).toBeNull();
    expect(container.querySelector(".has-window-controls")).toBeNull();
  });

  it("draws the three window controls on Windows and drops the right padding", async () => {
    const { container } = await toolbar("windows");
    expect(container.querySelector(".app-lights")).toBeNull();
    expect(container.querySelector(".has-window-controls")).not.toBeNull();
    for (const name of ["Minimize", "Maximize", "Close"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("sends each window action and turns Maximize into Restore", async () => {
    const user = userEvent.setup();
    const { transport } = await toolbar("windows");
    await user.click(screen.getByRole("button", { name: "Minimize" }));
    await user.click(screen.getByRole("button", { name: "Maximize" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(transport.windowActions).toEqual([
      "minimize",
      "toggleMaximize",
      "toggleMaximize",
      "close",
    ]);
  });

  it("lets a pushed state win over an older answer to the first query", async () => {
    const transport = fakeCore({}, "windows");
    let answer: (value: boolean) => void = () => undefined;
    transport.windowMaximized = () => new Promise<boolean>((done) => (answer = done));
    await renderWithStore(<WindowToolbar />, transport);
    const listeners = (
      transport as unknown as { maximizedListeners: Set<(value: boolean) => void> }
    ).maximizedListeners;
    for (const listener of listeners) listener(true);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument(),
    );
    answer(false);
    await new Promise((done) => setTimeout(done, 20));
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("follows a window that the user maximizes with the system", async () => {
    const { transport } = await toolbar("windows");
    transport.maximized = true;
    const listeners = (
      transport as unknown as { maximizedListeners: Set<(value: boolean) => void> }
    ).maximizedListeners;
    for (const listener of listeners) listener(true);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument(),
    );
  });
});
