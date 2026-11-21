import { describe, expect, it } from "vitest";
import {
  FINAL_LOADING_STEP,
  LOADING_LABEL_INTERVAL_MS,
  MAJOR_REVIEW_STEPS,
  majorStepIndexForStage,
  pickRandomLoadingLabel,
  REVIEW_LOADING_LABELS,
} from "./loadingSteps";

describe("loadingSteps", () => {
  it("provides 1000 unique abstract loading labels and fixed major steps", () => {
    expect(REVIEW_LOADING_LABELS).toHaveLength(1000);
    expect(new Set(REVIEW_LOADING_LABELS).size).toBe(1000);
    expect(REVIEW_LOADING_LABELS.every((label) => label.trim().length > 0)).toBe(true);
    expect(LOADING_LABEL_INTERVAL_MS).toBeGreaterThanOrEqual(8000);
    expect(MAJOR_REVIEW_STEPS).toEqual([
      "Preparing repository snapshot and diff",
      "Analyzing repository structure and conventions",
      "Reviewing branch changes",
      FINAL_LOADING_STEP,
    ]);
    expect(FINAL_LOADING_STEP).toBe("Building the view");
  });

  it("maps review stages to fixed major steps and avoids immediate label repeats", () => {
    expect(majorStepIndexForStage("preparing", false)).toBe(0);
    expect(majorStepIndexForStage("memory", false)).toBe(1);
    expect(majorStepIndexForStage("reviewing", false)).toBe(2);
    expect(majorStepIndexForStage("writing", false)).toBe(3);
    expect(majorStepIndexForStage("reviewing", true)).toBe(3);

    const first = pickRandomLoadingLabel();
    expect(REVIEW_LOADING_LABELS).toContain(first);
    const second = pickRandomLoadingLabel(first);
    expect(REVIEW_LOADING_LABELS).toContain(second);
    expect(second).not.toBe(first);
  });
});
