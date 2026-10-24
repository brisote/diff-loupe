import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../src/assets/screens/manifest.json";
import { findScene, sceneFiles } from "../src/lib/manifest";

const src = join(__dirname, "../src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : /\.(astro|ts)$/.test(entry.name)
        ? [readFileSync(join(dir, entry.name), "utf8")]
        : [],
  );
}

const used = new Set(
  sources(src).flatMap((source) =>
    [...source.matchAll(/scene(?:=|: )"([a-z0-9-]+)"/g)].map((match) => match[1] ?? ""),
  ),
);

describe("the screenshot manifest", () => {
  it("has exactly the scenes the pages use", () => {
    expect([...used].sort()).toEqual(manifest.scenes.map((scene) => scene.name).sort());
  });

  it("lists exactly the screenshot files", () => {
    const files = readdirSync(join(src, "assets/screens")).filter((file) => file.endsWith(".png"));
    expect(files.sort()).toEqual(sceneFiles(manifest.scenes).sort());
  });

  it("refuses a scene it does not have", () => {
    expect(() => findScene(manifest.scenes, "settings")).toThrow('no scene named "settings"');
  });
});
