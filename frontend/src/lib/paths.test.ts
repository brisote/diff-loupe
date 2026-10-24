import { describe, expect, it } from "vitest";
import { displayPath, splitPath } from "./paths";

describe("displayPath", () => {
  it("shortens the home folder to a tilde", () => {
    expect(displayPath("/Users/ada/Workspace/acme-billing", "/Users/ada")).toBe(
      "~/Workspace/acme-billing",
    );
    expect(displayPath("/Users/ada", "/Users/ada")).toBe("~");
  });

  it("keeps other paths and look-alike prefixes", () => {
    expect(displayPath("/Users/adam/x", "/Users/ada")).toBe("/Users/adam/x");
    expect(displayPath("/tmp/x", null)).toBe("/tmp/x");
  });
});

describe("splitPath", () => {
  it("splits a repository path into name and folder", () => {
    expect(splitPath("billing/src/Main.kt")).toEqual({ name: "Main.kt", folder: "billing/src" });
    expect(splitPath("README.md")).toEqual({ name: "README.md", folder: "" });
    expect(splitPath("vendor/lib/")).toEqual({ name: "lib", folder: "vendor" });
  });
});
