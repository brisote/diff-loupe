import { describe, expect, it } from "vitest";
import { hasModifier } from "../lib/platform";
import { identifierAt } from "./symbolNav";

describe("symbol navigation", () => {
  it("extracts identifiers at cursor positions and skips numbers and punctuation", () => {
    const line = "public Optional<Observation> getLatestObservation(long id)";
    expect(identifierAt(line, 32)).toEqual({
      symbol: "getLatestObservation",
      start: 29,
      end: 49,
    });
    expect(identifierAt(line, 49)).toEqual({
      symbol: "getLatestObservation",
      start: 29,
      end: 49,
    });
    expect(identifierAt("const n = 12345;", 11)).toBeNull();
    expect(identifierAt("a + b", 2)).toBeNull();
  });

  it("uses Command on macOS and Control on Windows and Linux", () => {
    expect(hasModifier("macos", { metaKey: true, ctrlKey: false, altKey: false })).toBe(true);
    expect(hasModifier("macos", { metaKey: false, ctrlKey: true, altKey: false })).toBe(false);
    expect(hasModifier("windows", { metaKey: false, ctrlKey: true, altKey: false })).toBe(true);
    expect(hasModifier("linux", { metaKey: false, ctrlKey: true, altKey: false })).toBe(true);
    expect(hasModifier("linux", { metaKey: true, ctrlKey: false, altKey: false })).toBe(false);
  });
});
