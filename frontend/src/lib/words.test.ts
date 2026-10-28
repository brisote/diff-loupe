import { describe, expect, it } from "vitest";
import { aboutRemoval, uninstallEffect } from "./words";

describe("platform words", () => {
  it("names the Trash and this Mac only on a Mac", () => {
    expect(aboutRemoval("macos")).toContain("Trash");
    expect(aboutRemoval("macos")).toContain("this Mac");
    expect(uninstallEffect("macos")).toContain("moves the app to the Trash");
    for (const platform of ["windows", "linux"] as const) {
      for (const text of [aboutRemoval(platform), uninstallEffect(platform)]) {
        expect(text).not.toMatch(/Mac|Trash/);
        expect(text).toContain("this computer");
      }
    }
  });

  it("says how each system removes the app", () => {
    expect(aboutRemoval("windows")).toContain("Installed apps");
    expect(aboutRemoval("linux")).toContain("package manager");
    expect(uninstallEffect("windows")).toContain("removes the app");
    expect(uninstallEffect("linux")).toContain("enter your password");
  });
});
