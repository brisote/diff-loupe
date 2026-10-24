import { describe, expect, it } from "vitest";
import { dayOf, due, fresh, notNow, parseStars, starred, used } from "./stars";
import { day } from "./updates";

const start = new Date(2026, 9, 1, 9).getTime();

function usedOn(days: number) {
  let stars = fresh;
  for (let index = 0; index < days; index++) stars = used(stars, start + index * day);
  return stars;
}

describe("the star prompt", () => {
  it("counts each day of use once", () => {
    const morning = used(fresh, start);
    const evening = used(morning, start + 8 * 60 * 60 * 1000);
    expect(evening.days).toBe(1);
    expect(used(evening, start + day).days).toBe(2);
    expect(evening.lastDay).toBe(dayOf(start));
    expect(used(evening, start - day)).toBe(evening);
  });

  it("waits for seven days of use", () => {
    expect(due(usedOn(6), start + 6 * day)).toBe(false);
    expect(due(usedOn(7), start + 7 * day)).toBe(true);
  });

  it("asks once more thirty days after Not now, then never again", () => {
    const asked = usedOn(7);
    const declined = notNow(asked, start + 7 * day);
    expect(due(declined, start + 36 * day)).toBe(false);
    expect(due(declined, start + 37 * day)).toBe(true);
    const twice = notNow(declined, start + 37 * day);
    expect(twice.done).toBe(true);
    expect(due(twice, start + 400 * day)).toBe(false);
  });

  it("never asks again after Star on GitHub", () => {
    expect(due(starred(usedOn(10)), start + 400 * day)).toBe(false);
  });

  it("reads a stored state and ignores anything else", () => {
    const stars = notNow(usedOn(8), start);
    expect(parseStars(JSON.stringify(stars))).toEqual(stars);
    expect(parseStars("not json")).toEqual(fresh);
    expect(parseStars(null)).toEqual(fresh);
    expect(parseStars(JSON.stringify({ days: "many" })).days).toBe(0);
  });
});
