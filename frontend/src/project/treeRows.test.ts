import { describe, expect, it } from "vitest";
import { buildProjectRows } from "./treeRows";

describe("buildProjectRows", () => {
  const dirs = {
    "": [
      { name: "src", path: "src", isDir: true, ignored: false },
      { name: "target", path: "target", isDir: true, ignored: true },
      { name: "README.md", path: "README.md", isDir: false, ignored: false },
    ],
    src: [
      { name: "App.java", path: "src/App.java", isDir: false, ignored: false },
      { name: "application.yml", path: "src/application.yml", isDir: false, ignored: false },
    ],
  };

  it("flattens expanded directories with depth", () => {
    const collapsed = buildProjectRows(dirs, {}, "");
    expect(collapsed.map((row) => [row.entry.path, row.depth])).toEqual([
      ["src", 0],
      ["target", 0],
      ["README.md", 0],
    ]);

    const expanded = buildProjectRows(dirs, { src: true }, "");
    expect(expanded.map((row) => [row.entry.path, row.depth])).toEqual([
      ["src", 0],
      ["src/App.java", 1],
      ["src/application.yml", 1],
      ["target", 0],
      ["README.md", 0],
    ]);
  });

  it("filters loaded entries and keeps matching parent directories", () => {
    const filtered = buildProjectRows(dirs, {}, "yml");
    expect(filtered.map((row) => row.entry.path)).toEqual(["src", "src/application.yml"]);
  });
});
