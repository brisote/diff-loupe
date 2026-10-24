import { expect, it } from "vitest";
import { buildMonth, shortVersion } from "./version";

it("drops a zero patch number", () => {
  expect(shortVersion("0.1.0")).toBe("0.1");
  expect(shortVersion("0.1.2")).toBe("0.1.2");
});

it("names the build month", () => {
  expect(buildMonth("2026-10-22T10:00:00Z")).toBe("October 2026");
});
