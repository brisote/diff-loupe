import { describe, expect, it } from "vitest";
import { formatBalanceUsd, formatReviewCostUsd } from "./money";

describe("formatBalanceUsd", () => {
  it("formats zero and near-zero values", () => {
    expect(formatBalanceUsd("0")).toBe("$0.00");
    expect(formatBalanceUsd("0.00")).toBe("$0.00");
    expect(formatBalanceUsd("0.0001")).toBe("$0.00");
  });

  it("rounds values to the cent", () => {
    expect(formatBalanceUsd("0.0099")).toBe("$0.01");
    expect(formatBalanceUsd("0.01")).toBe("$0.01");
    expect(formatBalanceUsd("9.99")).toBe("$9.99");
    expect(formatBalanceUsd("9.996")).toBe("$10.00");
    expect(formatBalanceUsd("10")).toBe("$10.00");
    expect(formatBalanceUsd("10.00")).toBe("$10.00");
  });

  it("handles negative and invalid values gracefully", () => {
    expect(formatBalanceUsd("-1")).toBe("$0.00");
    expect(formatBalanceUsd("-0.01")).toBe("$0.00");
    expect(formatBalanceUsd("")).toBe("$0.00");
    expect(formatBalanceUsd("   ")).toBe("$0.00");
    expect(formatBalanceUsd("invalid")).toBe("$0.00");
  });

  it("never includes the word credit", () => {
    const samples = ["0", "0.0001", "0.0099", "0.01", "9.996", "-5", "abc"];
    for (const sample of samples) {
      expect(formatBalanceUsd(sample).toLowerCase()).not.toContain("credit");
    }
  });
});

describe("formatReviewCostUsd", () => {
  it("formats zero as $0.00", () => {
    expect(formatReviewCostUsd("0")).toBe("$0.00");
    expect(formatReviewCostUsd("0.00")).toBe("$0.00");
  });

  it("formats sub-cent amounts as <$0.01", () => {
    expect(formatReviewCostUsd("0.0001")).toBe("<$0.01");
    expect(formatReviewCostUsd("0.0099")).toBe("<$0.01");
  });

  it("formats amounts at or above one cent", () => {
    expect(formatReviewCostUsd("0.01")).toBe("$0.01");
    expect(formatReviewCostUsd("0.14")).toBe("$0.14");
    expect(formatReviewCostUsd("9.996")).toBe("$10.00");
  });

  it("handles negative and invalid values gracefully", () => {
    expect(formatReviewCostUsd("-1")).toBe("$0.00");
    expect(formatReviewCostUsd("-0.01")).toBe("$0.00");
    expect(formatReviewCostUsd("")).toBe("$0.00");
    expect(formatReviewCostUsd("invalid")).toBe("$0.00");
  });

  it("never includes the word credit", () => {
    const samples = ["0", "0.0001", "0.0099", "0.01", "0.14", "9.996", "-5", "abc"];
    for (const sample of samples) {
      expect(formatReviewCostUsd(sample).toLowerCase()).not.toContain("credit");
    }
  });
});
