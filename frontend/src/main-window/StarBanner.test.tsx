import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { repository } from "../state/stars";
import { fakeCore, renderWithStore, settings } from "../test/render";
import { NoticeBanner } from "./NoticeBanner";

const asked = JSON.stringify({
  days: 7,
  lastDay: "2000-01-01",
  declined: 0,
  declinedAt: null,
  done: false,
});

const latest = { current: "0.2.0", latest: "0.2.0", newer: false, page: "" };
const nothing = { ready: null, failure: null, page: null };

function core(
  stars: string | null,
  check: () => unknown = () => latest,
  pending: unknown = nothing,
) {
  return fakeCore({
    get_settings: () => ({ ...settings, updates: { check: true } }),
    get_ui_value: (args) => ((args as { key: string }).key === "star.prompt" ? stars : null),
    check_update: check,
    update_state: () => pending,
  });
}

function saved(transport: ReturnType<typeof core>) {
  const last = transport.calls
    .filter((call) => call.cmd === "set_ui_value")
    .map((call) => call.args as { key: string; value: string })
    .filter((args) => args.key === "star.prompt")
    .at(-1);
  return last ? JSON.parse(last.value) : null;
}

describe("the star banner", () => {
  it("asks after seven days of use and opens the repository", async () => {
    const user = userEvent.setup();
    const transport = core(asked);
    await renderWithStore(<NoticeBanner />, transport);
    await user.click(await screen.findByRole("button", { name: "Star on GitHub" }));
    expect(transport.opened).toEqual([repository]);
    expect(screen.queryByText("Give us a star on GitHub.")).toBeNull();
    expect(saved(transport).done).toBe(true);
  });

  it("does not ask in the first days", async () => {
    const transport = core(null);
    await renderWithStore(<NoticeBanner />, transport);
    await act(async () => undefined);
    expect(screen.queryByText("Give us a star on GitHub.")).toBeNull();
    expect(saved(transport).days).toBe(1);
  });

  it("remembers Not now", async () => {
    const user = userEvent.setup();
    const transport = core(asked);
    await renderWithStore(<NoticeBanner />, transport);
    await user.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Give us a star on GitHub.")).toBeNull();
    expect(saved(transport)).toMatchObject({ declined: 1, done: false });
  });

  it("gives way to an update banner until the next start", async () => {
    const transport = core(asked, () => ({
      current: "0.2.0",
      latest: "0.3.0",
      newer: true,
      page: "https://github.com/brisote/diff-loupe/releases/tag/v0.3.0",
    }));
    const { store } = await renderWithStore(<NoticeBanner />, transport);
    await screen.findByText("Diffloupe 0.3.0");
    expect(screen.queryByText("Give us a star on GitHub.")).toBeNull();
    await act(async () => void store.getState().laterUpdate());
    expect(screen.queryByText("Give us a star on GitHub.")).toBeNull();
  });

  it("waits for the update check before it asks", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const transport = core(asked, () => new Promise((done) => (answer = done)));
    await renderWithStore(<NoticeBanner />, transport);
    await act(async () => undefined);
    expect(screen.queryByText("Give us a star on GitHub.")).toBeNull();
    await act(async () => answer(latest));
    expect(await screen.findByText("Give us a star on GitHub.")).toBeTruthy();
  });

  it("gives way to a git notice until the next start", async () => {
    const transport = core(asked);
    const { store } = await renderWithStore(<NoticeBanner />, transport);
    await screen.findByText("Give us a star on GitHub.");
    act(() =>
      store.setState({ notice: { kind: "success", parts: [{ text: "Pushed." }], actions: [] } }),
    );
    act(() => store.getState().dismissNotice());
    expect(screen.queryByText("Give us a star on GitHub.")).toBeNull();
  });

  it("gives way to an update that is ready to install", async () => {
    const transport = core(asked, () => latest, {
      ready: "0.3.0",
      failure: null,
      page: "https://github.com/brisote/diff-loupe/releases/tag/v0.3.0",
    });
    await renderWithStore(<NoticeBanner />, transport);
    await screen.findByText("is ready. It installs when you restart Diffloupe.", { exact: false });
    expect(screen.queryByText("Give us a star on GitHub.")).toBeNull();
  });

  it("keeps asking when the repository page could not open", async () => {
    const user = userEvent.setup();
    const transport = core(asked);
    transport.openLink = async () => {
      throw { code: "io", message: "open failed" };
    };
    await renderWithStore(<NoticeBanner />, transport);
    await user.click(await screen.findByRole("button", { name: "Star on GitHub" }));
    expect(saved(transport).done).toBe(false);
  });

  it("does not overwrite the stored answer when it cannot be read", async () => {
    const transport = fakeCore({
      get_ui_value: (args) => {
        if ((args as { key: string }).key === "star.prompt")
          throw { code: "store", message: "locked" };
        return null;
      },
      update_state: () => nothing,
    });
    await renderWithStore(<NoticeBanner />, transport);
    await act(async () => undefined);
    expect(saved(transport)).toBeNull();
  });
});
