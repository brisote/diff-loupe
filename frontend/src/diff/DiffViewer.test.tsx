import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Backend } from "../api";
import type { DiffSide } from "../api/generated/DiffSide";
import type { FileDiff } from "../api/generated/FileDiff";
import { fakeCore, renderWithStore, repoInfo } from "../test/render";
import { DiffViewer } from "./DiffViewer";

function side(exists: boolean, text: string, title: string | null = null): DiffSide {
  return {
    exists,
    text,
    crlf: false,
    encoding: "UTF-8",
    revision: exists ? "head" : null,
    title,
  };
}

const addedDiff: FileDiff = {
  path: "website/tsconfig.json",
  oldPath: null,
  content: "text",
  left: side(false, ""),
  right: side(true, '{\n  "extends": "astro/tsconfigs/strict"\n}\n', "Staged version"),
  blocks: [
    {
      kind: "inserted",
      leftStart: 0,
      leftEnd: 0,
      rightStart: 0,
      rightEnd: 3,
      hasWords: false,
      leftWords: [],
      rightWords: [],
    },
  ],
};

const deletedDiff: FileDiff = {
  path: "old.txt",
  oldPath: null,
  content: "text",
  left: side(true, "legacy\n"),
  right: side(false, ""),
  blocks: [
    {
      kind: "deleted",
      leftStart: 0,
      leftEnd: 1,
      rightStart: 0,
      rightEnd: 0,
      hasWords: false,
      leftWords: [],
      rightWords: [],
    },
  ],
};

const modifiedDiff: FileDiff = {
  path: "app.txt",
  oldPath: null,
  content: "text",
  left: side(true, "before\n"),
  right: side(true, "after\n"),
  blocks: [
    {
      kind: "modified",
      leftStart: 0,
      leftEnd: 1,
      rightStart: 0,
      rightEnd: 1,
      hasWords: false,
      leftWords: [],
      rightWords: [],
    },
  ],
};

describe("DiffViewer connectors", () => {
  it("renders no connector paths when the left side does not exist", () => {
    const { container } = render(
      <DiffViewer
        diff={addedDiff}
        current={0}
        collapse={false}
        sync={true}
        highlight="words"
        onCurrent={() => {}}
      />,
    );
    expect(container.querySelectorAll(".dl-conn")).toHaveLength(0);
  });

  it("renders no connector paths when the right side does not exist", () => {
    const { container } = render(
      <DiffViewer
        diff={deletedDiff}
        current={0}
        collapse={false}
        sync={true}
        highlight="words"
        onCurrent={() => {}}
      />,
    );
    expect(container.querySelectorAll(".dl-conn")).toHaveLength(0);
  });

  it("renders connector paths when both sides exist", () => {
    const { container } = render(
      <DiffViewer
        diff={modifiedDiff}
        current={0}
        collapse={false}
        sync={true}
        highlight="words"
        onCurrent={() => {}}
      />,
    );
    expect(container.querySelectorAll(".dl-conn")).toHaveLength(1);
  });
});

describe("DiffViewer resizable divider", () => {
  it("loads saved divider ratio from backend and applies grid columns", async () => {
    let requestedKey = "";
    const transport = fakeCore({
      get_ui_value: (args) => {
        requestedKey = (args as { key: string }).key;
        return "0.65";
      },
    });
    const backend = new Backend(transport);
    const { container } = render(
      <DiffViewer
        diff={modifiedDiff}
        current={0}
        collapse={false}
        sync={true}
        highlight="words"
        backend={backend}
        onCurrent={() => {}}
      />,
    );
    const separator = container.querySelector(".app-diff-handle") as HTMLElement;
    expect(separator).toBeDefined();
    await waitFor(() => {
      expect(separator.getAttribute("aria-valuenow")).toBe("65");
    });
    expect(requestedKey).toBe("diffDividerRatio");
    const section = container.querySelector(".app-diff") as HTMLElement;
    expect(section.style.gridTemplateColumns).toContain("0.65fr");
  });

  it("resets ratio on double click and saves to backend", async () => {
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
      <DiffViewer
        diff={modifiedDiff}
        current={0}
        collapse={false}
        sync={true}
        highlight="words"
        backend={backend}
        onCurrent={() => {}}
      />,
    );
    const separator = container.querySelector(".app-diff-handle") as HTMLElement;
    await waitFor(() => {
      expect(separator.getAttribute("aria-valuenow")).toBe("70");
    });
    fireEvent.doubleClick(separator);
    expect(separator.getAttribute("aria-valuenow")).toBe("50");
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
      <DiffViewer
        diff={modifiedDiff}
        current={0}
        collapse={false}
        sync={true}
        highlight="words"
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
      <DiffViewer
        diff={modifiedDiff}
        current={0}
        collapse={false}
        sync={true}
        highlight="words"
        backend={backend}
        onCurrent={() => {}}
      />,
    );
    const separator = container.querySelector(".app-diff-handle") as HTMLElement;
    const section = container.querySelector(".app-diff") as HTMLElement;
    Object.defineProperty(section, "clientWidth", { configurable: true, value: 1104 });
    separator.setPointerCapture = () => {};
    separator.releasePointerCapture = () => {};
    separator.hasPointerCapture = () => true;

    fireEvent.pointerDown(separator, { button: 0, clientX: 552, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 652, pointerId: 1 });
    expect(separator.getAttribute("aria-valuenow")).toBe("60");

    fireEvent.pointerUp(separator, { pointerId: 1 });
    expect(saved).toEqual({ key: "diffDividerRatio", value: "0.6" });
  });

  it("configures right pane as editable when editable prop is true", () => {
    const { container } = render(
      <DiffViewer
        diff={modifiedDiff}
        current={0}
        collapse={false}
        sync={true}
        highlight="words"
        editable={true}
        onCurrent={() => {}}
      />,
    );
    const leftContent = container.querySelector(".is-left .cm-content");
    const rightContent = container.querySelector(".is-right .cm-content");
    expect(leftContent?.getAttribute("contenteditable")).toBe("false");
    expect(rightContent?.getAttribute("contenteditable")).toBe("true");
  });

  it("keeps both panes read-only when editable is false", () => {
    const { container } = render(
      <DiffViewer
        diff={modifiedDiff}
        current={0}
        collapse={false}
        sync={true}
        highlight="words"
        editable={false}
        onCurrent={() => {}}
      />,
    );
    const leftContent = container.querySelector(".is-left .cm-content");
    const rightContent = container.querySelector(".is-right .cm-content");
    expect(leftContent?.getAttribute("contenteditable")).toBe("false");
    expect(rightContent?.getAttribute("contenteditable")).toBe("false");
  });

  it("flushes debounced save when blurring editable pane", async () => {
    let saved: { path: string; file: string; text: string } | null = null;
    const core = fakeCore({
      current_repo: () => ({ ...repoInfo("acme-billing"), lastTab: "changes" }),
      save_file: (args) => {
        saved = args as { path: string; file: string; text: string };
        return null;
      },
    });
    const { container } = await renderWithStore(
      <DiffViewer
        diff={modifiedDiff}
        current={0}
        collapse={false}
        sync={true}
        highlight="words"
        editable={true}
        onCurrent={() => {}}
      />,
      core,
    );
    const rightContent = container.querySelector(".app-diff-right .cm-content") as HTMLElement;
    expect(rightContent).not.toBeNull();
    fireEvent.blur(rightContent);
    expect(saved).toBeNull();
  });

  it("renders revert button and reverts block when clicked", async () => {
    let saved: { path: string; file: string; text: string } | null = null;
    const core = fakeCore({
      current_repo: () => ({ ...repoInfo("acme-billing"), lastTab: "changes" }),
      save_file: (args) => {
        saved = args as { path: string; file: string; text: string };
        return null;
      },
    });
    const { container } = await renderWithStore(
      <DiffViewer
        diff={modifiedDiff}
        current={0}
        collapse={false}
        sync={true}
        highlight="words"
        editable={true}
        onCurrent={() => {}}
      />,
      core,
    );
    const revertBtn = container.querySelector(".dl-divider .dl-chev") as HTMLButtonElement;
    expect(revertBtn).not.toBeNull();
    expect(revertBtn.getAttribute("aria-label")).toBe("Revert this change");
    fireEvent.click(revertBtn);
    expect(saved).toEqual({
      path: "/Users/ada/Workspace/acme-billing",
      file: "app.txt",
      text: "before\n",
    });
  });

  it("does not render revert button when editable is false", () => {
    const { container } = render(
      <DiffViewer
        diff={modifiedDiff}
        current={0}
        collapse={false}
        sync={true}
        highlight="words"
        editable={false}
        onCurrent={() => {}}
      />,
    );
    const revertBtn = container.querySelector(".dl-divider .dl-chev");
    expect(revertBtn).toBeNull();
  });
});
