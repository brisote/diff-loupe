import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Backend } from "../api";
import type { FileDiff } from "../api/generated/FileDiff";
import { fakeCore } from "../test/render";
import { MarkdownDiff, markdownRows } from "./MarkdownDiff";

const sampleDiff: FileDiff = {
  path: "README.md",
  oldPath: null,
  content: "text",
  left: {
    exists: true,
    text: "# Old Title\n\nSome text\n",
    crlf: false,
    encoding: "UTF-8",
    revision: "head",
    title: null,
  },
  right: {
    exists: true,
    text: "# New Title\n\nSome text\n",
    crlf: false,
    encoding: "UTF-8",
    revision: null,
    title: "Working tree",
  },
  blocks: [],
};

const rows = markdownRows(sampleDiff.left.text, sampleDiff.right.text);

describe("MarkdownDiff divider", () => {
  it("loads persisted ratio from backend and resets on double-click", async () => {
    let saved: { key: string; value: string } | null = null;
    const transport = fakeCore({
      get_ui_value: () => "0.7",
      set_ui_value: (args) => {
        saved = args as { key: string; value: string };
        return null;
      },
    });
    const backend = new Backend(transport);
    const { container } = render(
      <MarkdownDiff
        diff={sampleDiff}
        rows={rows}
        inline={false}
        collapse={false}
        current={0}
        backend={backend}
        onCurrent={() => {}}
      />,
    );
    const separator = container.querySelector(".app-diff-handle") as HTMLElement;
    expect(separator).not.toBeNull();
    await waitFor(() => {
      expect(separator.getAttribute("aria-valuenow")).toBe("70");
    });
    const panes = container.querySelector(".app-md-panes") as HTMLElement;
    expect(panes.style.gridTemplateColumns).toContain("0.7fr");

    fireEvent.doubleClick(separator);
    expect(separator.getAttribute("aria-valuenow")).toBe("50");
    expect(panes.style.gridTemplateColumns).toContain("0.5fr");
    expect(saved).toEqual({ key: "diffDividerRatio", value: "0.5" });
  });

  it("adjusts ratio via keyboard arrows", async () => {
    let saved: { key: string; value: string } | null = null;
    const transport = fakeCore({
      get_ui_value: () => "0.5",
      set_ui_value: (args) => {
        saved = args as { key: string; value: string };
        return null;
      },
    });
    const backend = new Backend(transport);
    const { container } = render(
      <MarkdownDiff
        diff={sampleDiff}
        rows={rows}
        inline={false}
        collapse={false}
        current={0}
        backend={backend}
        onCurrent={() => {}}
      />,
    );
    const separator = container.querySelector(".app-diff-handle") as HTMLElement;
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator.getAttribute("aria-valuenow")).toBe("55");
    expect(saved).toEqual({ key: "diffDividerRatio", value: "0.55" });

    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator.getAttribute("aria-valuenow")).toBe("50");
    expect(saved).toEqual({ key: "diffDividerRatio", value: "0.5" });
  });

  it("resizes panes via pointer drag and clamps to bounds", async () => {
    let saved: { key: string; value: string } | null = null;
    const transport = fakeCore({
      get_ui_value: () => null,
      set_ui_value: (args) => {
        saved = args as { key: string; value: string };
        return null;
      },
    });
    const backend = new Backend(transport);
    const { container } = render(
      <MarkdownDiff
        diff={sampleDiff}
        rows={rows}
        inline={false}
        collapse={false}
        current={0}
        backend={backend}
        onCurrent={() => {}}
      />,
    );
    const separator = container.querySelector(".app-diff-handle") as HTMLElement;
    const panes = container.querySelector(".app-md-panes") as HTMLElement;
    Object.defineProperty(panes, "clientWidth", { configurable: true, value: 1024 });
    separator.setPointerCapture = () => {};
    separator.releasePointerCapture = () => {};
    separator.hasPointerCapture = () => true;

    fireEvent.pointerDown(separator, { button: 0, clientX: 512, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 612, pointerId: 1 });
    expect(separator.getAttribute("aria-valuenow")).toBe("60");
    expect(panes.style.gridTemplateColumns).toContain("0.6fr");

    fireEvent.pointerUp(separator, { pointerId: 1 });
    expect(saved).toEqual({ key: "diffDividerRatio", value: "0.6" });
  });

  it("does not render divider in inline mode", () => {
    const { container } = render(
      <MarkdownDiff
        diff={sampleDiff}
        rows={rows}
        inline={true}
        collapse={false}
        current={0}
        onCurrent={() => {}}
      />,
    );
    expect(container.querySelector(".app-diff-handle")).toBeNull();
  });
});
