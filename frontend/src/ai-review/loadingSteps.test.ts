import { describe, expect, it } from "vitest";
import { FINAL_LOADING_STEP, pickLoadingSequence, REVIEW_LOADING_LABELS } from "./loadingSteps";

describe("loadingSteps", () => {
  it("provides 100 unique diff and review loading labels", () => {
    expect(REVIEW_LOADING_LABELS).toHaveLength(100);
    expect(new Set(REVIEW_LOADING_LABELS).size).toBe(100);
    expect(REVIEW_LOADING_LABELS.every((label) => label.trim().length > 0)).toBe(true);
    expect(FINAL_LOADING_STEP).toBe("Building the view");
  });

  it("picks a deterministic sequence starting with repository snapshot preparation", () => {
    const first = pickLoadingSequence("run-1", 12);
    const repeat = pickLoadingSequence("run-1", 12);
    expect(first).toHaveLength(12);
    expect(first).toEqual(repeat);
    expect(first[0]).toBe(REVIEW_LOADING_LABELS[0]);
    expect(new Set(first).size).toBe(12);
  });
});
