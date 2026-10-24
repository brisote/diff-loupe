import { expect, it } from "vitest";
import { clampWidth } from "./Splitter";

it("keeps the tool window width between its limits", () => {
  expect(clampWidth(100, 260, 900)).toBe(260);
  expect(clampWidth(1200, 260, 900)).toBe(900);
  expect(clampWidth(400.4, 260, 900)).toBe(400);
  expect(clampWidth(500, 260, 100)).toBe(260);
});
