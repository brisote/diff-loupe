import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DiffSide } from "../api/generated/DiffSide";
import type { FileDiff } from "../api/generated/FileDiff";
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
