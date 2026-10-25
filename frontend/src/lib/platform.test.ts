import { describe, expect, it } from "vitest";
import { hasModifier, platformOf, shortcut } from "./platform";

describe("shortcut", () => {
  it("writes the Mac symbols in IntelliJ's order", () => {
    expect(shortcut("macos", "Mod+K")).toBe("⌘K");
    expect(shortcut("macos", "Shift+Mod+K")).toBe("⇧⌘K");
    expect(shortcut("macos", "Mod+,")).toBe("⌘,");
    expect(shortcut("macos", "Alt+F12")).toBe("⌥F12");
    expect(shortcut("macos", "Shift+F7")).toBe("⇧F7");
    expect(shortcut("macos", "Shift+Esc")).toBe("⇧Esc");
    expect(shortcut("macos", "F7")).toBe("F7");
  });

  it("writes Ctrl, Alt and Shift in words on Windows and Linux", () => {
    for (const platform of ["windows", "linux"] as const) {
      expect(shortcut(platform, "Mod+K")).toBe("Ctrl+K");
      expect(shortcut(platform, "Shift+Mod+K")).toBe("Ctrl+Shift+K");
      expect(shortcut(platform, "Mod+,")).toBe("Ctrl+,");
      expect(shortcut(platform, "Alt+F12")).toBe("Alt+F12");
      expect(shortcut(platform, "Shift+F7")).toBe("Shift+F7");
      expect(shortcut(platform, "Shift+Esc")).toBe("Shift+Esc");
      expect(shortcut(platform, "F7")).toBe("F7");
    }
  });
});

describe("hasModifier", () => {
  it("asks for Command on a Mac and for Control elsewhere", () => {
    const command = { metaKey: true, ctrlKey: false, altKey: false };
    const control = { metaKey: false, ctrlKey: true, altKey: false };
    expect(hasModifier("macos", command)).toBe(true);
    expect(hasModifier("macos", control)).toBe(false);
    expect(hasModifier("windows", control)).toBe(true);
    expect(hasModifier("windows", command)).toBe(false);
    expect(hasModifier("linux", control)).toBe(true);
    expect(hasModifier("linux", command)).toBe(false);
  });

  it("does not take AltGr, which Windows reports as Control and Alt together", () => {
    const altGr = { metaKey: false, ctrlKey: true, altKey: true };
    expect(hasModifier("windows", altGr)).toBe(false);
    expect(hasModifier("linux", altGr)).toBe(false);
  });
});

describe("platformOf", () => {
  it("uses the core's platform and starts on macOS before it is known", () => {
    expect(platformOf(null)).toBe("macos");
    expect(platformOf(undefined)).toBe("macos");
    expect(platformOf({ platform: "windows" })).toBe("windows");
    expect(platformOf({ platform: "linux" })).toBe("linux");
  });
});
