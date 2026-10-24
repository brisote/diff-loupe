import { describe, expect, it } from "vitest";
import { fullDate, relativeDate } from "./dates";

const now = new Date(2026, 9, 22, 18, 30);
const at = (date: Date) => date.getTime() / 1000;

describe("relativeDate", () => {
  it("counts minutes and hours today", () => {
    expect(relativeDate(at(new Date(2026, 9, 22, 18, 29, 40)), now)).toBe("Just now");
    expect(relativeDate(at(new Date(2026, 9, 22, 18, 29)), now)).toBe("1 minute ago");
    expect(relativeDate(at(new Date(2026, 9, 22, 16, 15)), now)).toBe("2 hours ago");
  });

  it("names yesterday, then counts days for a week", () => {
    expect(relativeDate(at(new Date(2026, 9, 21, 23, 50)), now)).toBe("Yesterday");
    expect(relativeDate(at(new Date(2026, 9, 19, 9, 0)), now)).toBe("3 days ago");
  });

  it("shows the date after a week, with the year only when it differs", () => {
    expect(relativeDate(at(new Date(2026, 9, 2, 9, 0)), now)).toBe("2 Oct");
    expect(relativeDate(at(new Date(2025, 11, 31, 9, 0)), now)).toBe("31 Dec 2025");
  });

  it("treats a time in the future as now", () => {
    expect(relativeDate(at(new Date(2026, 9, 22, 19, 0)), now)).toBe("Just now");
  });
});

describe("fullDate", () => {
  it("adds the time of day", () => {
    expect(fullDate(at(new Date(2026, 9, 22, 9, 5)), now)).toBe("Today at 9:05");
    expect(fullDate(at(new Date(2026, 9, 21, 16, 42)), now)).toBe("Yesterday at 16:42");
    expect(fullDate(at(new Date(2026, 8, 3, 7, 0)), now)).toBe("3 Sep at 7:00");
  });
});
