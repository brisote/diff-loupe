import { describe, expect, it } from "vitest";
import { day, offered, parseLater } from "./updates";

const check = {
  current: "0.2.0",
  latest: "0.3.0",
  newer: true,
  page: "https://github.com/brisote/diff-loupe/releases/tag/v0.3.0",
};

describe("offered", () => {
  it("offers a newer release", () => {
    expect(offered(check, null, 0)).toBe(true);
  });

  it("does not offer the same or an older release", () => {
    expect(offered({ ...check, newer: false }, null, 0)).toBe(false);
  });

  it("waits a day after Later for the same release", () => {
    const later = { version: "0.3.0", until: day };
    expect(offered(check, later, day - 1)).toBe(false);
    expect(offered(check, later, day)).toBe(true);
  });

  it("offers a release newer than the one put off", () => {
    expect(offered({ ...check, latest: "0.4.0" }, { version: "0.3.0", until: day }, 0)).toBe(true);
  });
});

describe("parseLater", () => {
  it("reads a stored Later and ignores anything else", () => {
    expect(parseLater(JSON.stringify({ version: "0.3.0", until: 5 }))).toEqual({
      version: "0.3.0",
      until: 5,
    });
    expect(parseLater(null)).toBeNull();
    expect(parseLater("not json")).toBeNull();
    expect(parseLater(JSON.stringify({ version: 3 }))).toBeNull();
  });
});
