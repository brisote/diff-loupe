import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeCore, renderWithStore, settings } from "../test/render";
import { NoticeBanner } from "./NoticeBanner";

const page = "https://github.com/brisote/diff-loupe/releases/tag/v0.3.0";
const newer = { current: "0.2.0", latest: "0.3.0", newer: true, page };

const failed =
  "Diffloupe 0.3.0 was not installed because its download does not match the checksum, and 0.2.0 is unchanged.";

function core(
  stored: string | null = null,
  check: unknown = newer,
  download: (args: unknown) => unknown = () => ({ version: "0.3.0" }),
  pending: unknown = { ready: null, failure: null, page: null },
) {
  return fakeCore({
    download_update: download,
    update_state: () => pending,
    dismiss_update: () => null,
    get_settings: () => ({ ...settings, updates: { check: true } }),
    get_ui_value: () => stored,
    check_update: () => {
      if (check instanceof Error) throw { code: "update", message: check.message };
      return check;
    },
  });
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("the update banner", () => {
  it("offers a newer release at start", async () => {
    const transport = core();
    await renderWithStore(<NoticeBanner />, transport);
    expect(await screen.findByText("Diffloupe 0.3.0")).toBeTruthy();
    expect(transport.calls.filter((call) => call.cmd === "check_update")).toHaveLength(1);
  });

  it("opens the release notes", async () => {
    const user = userEvent.setup();
    const transport = core();
    await renderWithStore(<NoticeBanner />, transport);
    await user.click(await screen.findByRole("button", { name: "Release notes" }));
    expect(transport.opened).toEqual([page]);
  });

  it("downloads on Update, then installs on Restart now", async () => {
    const user = userEvent.setup();
    const transport = core();
    await renderWithStore(<NoticeBanner />, transport);
    await user.click(await screen.findByRole("button", { name: "Update" }));
    expect(
      await screen.findByText("is ready. It installs when you restart Diffloupe.", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(transport.calls.some((call) => call.cmd === "download_update")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Restart now" }));
    expect(transport.installed).toBe(true);
  });

  it("says why a download failed and offers to try again", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const transport = core(null, newer, () => {
      attempts++;
      throw { code: "update", message: failed };
    });
    await renderWithStore(<NoticeBanner />, transport);
    await user.click(await screen.findByRole("button", { name: "Update" }));
    expect(await screen.findByText(failed)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(attempts).toBe(2);
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByText(failed)).toBeNull();
  });

  it("offers the update again when the download is cancelled", async () => {
    const user = userEvent.setup();
    const transport = core(null, newer, () => {
      throw { code: "cancelled", message: "The operation was cancelled." };
    });
    await renderWithStore(<NoticeBanner />, transport);
    await user.click(await screen.findByRole("button", { name: "Update" }));
    expect(await screen.findByRole("button", { name: "Update" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Diffloupe 0.3.0 is available.");
    expect(screen.queryByText("The operation was cancelled.")).toBeNull();
  });

  it("says why an install failed", async () => {
    const user = userEvent.setup();
    const transport = core();
    transport.installError = { code: "io", message: failed };
    await renderWithStore(<NoticeBanner />, transport);
    await user.click(await screen.findByRole("button", { name: "Update" }));
    await user.click(await screen.findByRole("button", { name: "Restart now" }));
    expect(await screen.findByText(failed)).toBeTruthy();
  });

  it("hides on Later and remembers the release for a day", async () => {
    const user = userEvent.setup();
    const transport = core();
    await renderWithStore(<NoticeBanner />, transport);
    await user.click(await screen.findByRole("button", { name: "Later" }));
    expect(screen.queryByText("Diffloupe 0.3.0")).toBeNull();
    const stored = transport.calls
      .filter((call) => call.cmd === "set_ui_value")
      .map((call) => call.args as { key: string; value: string })
      .find((args) => args.key === "update.later");
    expect(stored).toBeDefined();
    if (!stored) return;
    expect(JSON.parse(stored.value).version).toBe("0.3.0");
  });

  it("stays hidden at start while Later still applies", async () => {
    const transport = core(JSON.stringify({ version: "0.3.0", until: Date.now() + 60_000 }));
    await renderWithStore(<NoticeBanner />, transport);
    await settle();
    expect(screen.queryByText("Diffloupe 0.3.0")).toBeNull();
  });

  it("makes no request when automatic checks are off", async () => {
    const transport = fakeCore({ check_update: () => newer });
    await renderWithStore(<NoticeBanner />, transport);
    await settle();
    expect(transport.calls.some((call) => call.cmd === "check_update")).toBe(false);
  });

  it("says nothing when an automatic check fails", async () => {
    const transport = core(null, new Error("diffloupe.com could not be reached."));
    const { store } = await renderWithStore(<NoticeBanner />, transport);
    await settle();
    expect(screen.queryByRole("status")).toBeNull();
    expect(store.getState().updateStatus).toEqual({ state: "idle" });
  });

  it("waits for the next start once a git notice was shown", async () => {
    const transport = core();
    const { store } = await renderWithStore(<NoticeBanner />, transport);
    await screen.findByText("Diffloupe 0.3.0");
    act(() =>
      store.setState({
        notice: { kind: "success", parts: [{ text: "Pushed." }], actions: [] },
      }),
    );
    act(() => store.getState().dismissNotice());
    expect(screen.queryByText("Diffloupe 0.3.0")).toBeNull();
  });

  it("goes away when automatic checks are turned off", async () => {
    const transport = core();
    const { store } = await renderWithStore(<NoticeBanner />, transport);
    await screen.findByText("Diffloupe 0.3.0");
    act(() => void store.getState().saveSettings({ ...settings, updates: { check: false } }));
    expect(screen.queryByText("Diffloupe 0.3.0")).toBeNull();
  });

  it("checks again once a day has passed since the last check", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "Date"] });
    try {
      const transport = core();
      await renderWithStore(<NoticeBanner />, transport);
      await vi.advanceTimersByTimeAsync(0);
      const checks = () => transport.calls.filter((call) => call.cmd === "check_update").length;
      expect(checks()).toBe(1);
      await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000);
      expect(checks()).toBe(1);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(checks()).toBe(2);
      expect(
        transport.calls.some((call) => (call.args as { key?: string })?.key === "update.lastCheck"),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks the core for the version the banner offers", async () => {
    const user = userEvent.setup();
    const asked: unknown[] = [];
    const transport = core(null, newer, (args) => {
      asked.push(args);
      return { version: "0.3.0" };
    });
    await renderWithStore(<NoticeBanner />, transport);
    await user.click(await screen.findByRole("button", { name: "Update" }));
    await screen.findByRole("button", { name: "Restart now" });
    expect(asked).toEqual([{ version: "0.3.0" }]);
  });

  it("installs once however often Restart now is pressed", async () => {
    const user = userEvent.setup();
    const transport = core();
    await renderWithStore(<NoticeBanner />, transport);
    await user.click(await screen.findByRole("button", { name: "Update" }));
    await user.click(await screen.findByRole("button", { name: "Restart now" }));
    expect(screen.queryByRole("button", { name: "Restart now" })).toBeNull();
    expect(transport.installs).toBe(1);
  });

  it("shows a download that is still ready after a restart", async () => {
    const transport = core(null, { ...newer, newer: false }, undefined, {
      ready: "0.3.0",
      failure: null,
      page,
    });
    await renderWithStore(<NoticeBanner />, transport);
    expect(
      await screen.findByText("is ready. It installs when you restart Diffloupe.", {
        exact: false,
      }),
    ).toBeTruthy();
  });

  it("reports an install that failed while the app was closed, until Later", async () => {
    const user = userEvent.setup();
    const transport = core(null, { ...newer, newer: false }, undefined, {
      ready: null,
      failure: failed,
      page,
    });
    await renderWithStore(<NoticeBanner />, transport);
    expect(await screen.findByText(failed)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByText(failed)).toBeNull();
    expect(transport.calls.some((call) => call.cmd === "dismiss_update")).toBe(true);
  });
});
