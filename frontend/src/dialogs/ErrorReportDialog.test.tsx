import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { issueForm } from "../state/reports";
import { fakeCore, renderWithStore } from "../test/render";
import { ErrorReportDialog } from "./ErrorReportDialog";

describe("the error report dialog", () => {
  it("opens on an unhandled error and opens the issue form", async () => {
    const user = userEvent.setup();
    const transport = fakeCore({
      get_ui_value: () => {
        throw { code: "store", message: "storage failed: database is locked", path: null };
      },
    });
    await renderWithStore(<ErrorReportDialog />, transport);
    const report = await screen.findByRole("textbox", { name: "Error report" });
    expect((report as HTMLTextAreaElement).value).toContain("`store` in `get_ui_value`");
    expect((report as HTMLTextAreaElement).value).toContain("Diffloupe 0.2.0 on macOS 26.1");
    await user.click(screen.getByRole("button", { name: "Open GitHub issue" }));
    expect(transport.opened).toEqual([issueForm]);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays closed for an error the app explains", async () => {
    const transport = fakeCore({
      open_repo: () => {
        throw { code: "notARepository", message: "/x is not a git repository", path: "/x" };
      },
    });
    const { store } = await renderWithStore(<ErrorReportDialog />, transport);
    await act(async () => store.getState().open("/x"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("adds a second error to the open report", async () => {
    const transport = fakeCore();
    const { store } = await renderWithStore(<ErrorReportDialog />, transport);
    act(() => store.getState().reportUiError(new TypeError("first")));
    act(() => store.getState().reportUiError(new TypeError("second")));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const text = (screen.getByRole("textbox", { name: "Error report" }) as HTMLTextAreaElement)
      .value;
    expect(text).toContain("TypeError: first");
    expect(text).toContain("TypeError: second");
  });

  it("does not come back for an error the user already closed", async () => {
    const user = userEvent.setup();
    const transport = fakeCore();
    const { store } = await renderWithStore(<ErrorReportDialog />, transport);
    act(() => store.getState().reportUiError(new TypeError("same")));
    await user.click(screen.getByRole("button", { name: "Close" }));
    act(() => store.getState().reportUiError(new TypeError("same")));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => store.getState().reportUiError(new TypeError("other")));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
