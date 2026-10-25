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

describe("displayPath on Windows", () => {
  it("shortens the home folder and ignores the case of the drive and folders", () => {
    expect(displayPath("C:\\Users\\ada\\work\\acme", "C:\\Users\\ada")).toBe("~\\work\\acme");
    expect(displayPath("c:\\users\\ADA\\work", "C:\\Users\\ada")).toBe("~\\work");
    expect(displayPath("C:\\Users\\ada", "C:\\Users\\ada\\")).toBe("~");
    expect(displayPath("D:\\work\\my repo", "C:\\Users\\ada")).toBe("D:\\work\\my repo");
    expect(displayPath("C:\\Users\\adam\\x", "C:\\Users\\ada")).toBe("C:\\Users\\adam\\x");
  });

  it("shortens verbatim and mixed-separator paths and handles UNC homes", () => {
    expect(displayPath("\\\\?\\C:\\Users\\ada\\repo", "C:\\Users\\ada")).toBe("~\\repo");
    expect(displayPath("C:/Users/ada/repo", "C:\\Users\\ada")).toBe("~\\repo");
    expect(displayPath("\\\\server\\home\\ada\\x", "\\\\server\\home\\ada")).toBe("~\\x");
  });

  it("leaves paths alone when the home folder is the root", () => {
    expect(displayPath("/x", "/")).toBe("/x");
  });

  it("keeps the case of a Unix home folder", () => {
    expect(displayPath("/home/Ada/x", "/home/ada")).toBe("/home/Ada/x");
  });
});

describe("splitPath", () => {
  it("splits a repository path into name and folder", () => {
    expect(splitPath("billing/src/Main.kt")).toEqual({ name: "Main.kt", folder: "billing/src" });
    expect(splitPath("README.md")).toEqual({ name: "README.md", folder: "" });
    expect(splitPath("vendor/lib/")).toEqual({ name: "lib", folder: "vendor" });
  });

  it("keeps a backslash in a file name, which git paths may contain on macOS and Linux", () => {
    expect(splitPath("docs/a\\b.txt")).toEqual({ name: "a\\b.txt", folder: "docs" });
  });
});
