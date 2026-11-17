import { describe, expect, it } from "vitest";
import { parseStructuredReport, scoreTier } from "./structuredReport";

const CANONICAL_IDS = [
  "encapsulation",
  "idempotency",
  "edge_cases",
  "error_handling",
  "logs",
  "monitoring",
  "security",
  "concurrency",
  "transactions",
  "performance",
  "breaking_changes",
  "test_coverage",
  "dependencies",
];

function makeCategoryPayload(id: string, score = 8) {
  if (id === "test_coverage") {
    return {
      id,
      title: "Test coverage",
      score,
      summary: "Covers happy path and invalid currency fallback.",
      problems: [
        {
          title: "Missing negative amount test",
          description: "Add unit test for negative invoice totals.",
          location: "billing/InvoiceExporterTest.kt:44",
          severity: "medium",
        },
      ],
      coverage_percent: 72,
      test_scenarios: ["Valid ISO-4217 currency export", "Null currency fallback"],
    };
  }
  if (id === "dependencies") {
    return {
      id,
      title: "New dependencies",
      score,
      summary: "No new runtime dependencies added.",
      problems: [],
      dependencies_introduced: false,
      dependency_tradeoff: "No new dependencies were introduced; avoids supply-chain overhead.",
    };
  }
  return {
    id,
    title: id,
    score,
    summary: `Summary for ${id}.`,
    problems: [],
  };
}

describe("scoreTier", () => {
  it("maps scores 8 to 10 to good", () => {
    expect(scoreTier(8)).toBe("good");
    expect(scoreTier(9)).toBe("good");
    expect(scoreTier(10)).toBe("good");
  });

  it("maps scores 5 to 7 to warn", () => {
    expect(scoreTier(5)).toBe("warn");
    expect(scoreTier(6)).toBe("warn");
    expect(scoreTier(7)).toBe("warn");
  });

  it("maps scores 1 to 4 to bad", () => {
    expect(scoreTier(1)).toBe("bad");
    expect(scoreTier(2)).toBe("bad");
    expect(scoreTier(3)).toBe("bad");
    expect(scoreTier(4)).toBe("bad");
  });
});

describe("parseStructuredReport", () => {
  it("parses a complete 13-category JSON payload in canonical order", () => {
    const payload = {
      schema_version: 1,
      overview: "Branch review: invoice export currency support",
      categories: CANONICAL_IDS.map((id, index) => makeCategoryPayload(id, index === 2 ? 4 : 9)),
      blast_radius: "Affects invoice export endpoints and CSV serializer.",
      deployment_risks: "Existing consumers may see an extra currency column.",
      rollback_plan: "Revert the invoice-export commit and redeploy.",
    };

    const result = parseStructuredReport(JSON.stringify(payload));
    expect(result.kind).toBe("structured");
    if (result.kind !== "structured") return;

    expect(result.report.overview).toBe("Branch review: invoice export currency support");
    expect(result.report.categories).toHaveLength(13);
    expect(result.report.categories.map((c) => c.id)).toEqual(CANONICAL_IDS);
    expect(result.report.categories[2]?.score).toBe(4);
    expect(result.report.blastRadius).toBe("Affects invoice export endpoints and CSV serializer.");
    expect(result.report.deploymentRisks).toBe(
      "Existing consumers may see an extra currency column.",
    );
    expect(result.report.rollbackPlan).toBe("Revert the invoice-export commit and redeploy.");
  });

  it("normalizes out-of-order and missing categories into the 13 canonical categories", () => {
    const payload = {
      overview: "Partial categories",
      categories: [
        makeCategoryPayload("dependencies", 10),
        makeCategoryPayload("security", 6),
        makeCategoryPayload("encapsulation", 9),
      ],
      blast_radius: "Limited to auth module.",
      deployment_risks: "Low risk.",
      rollback_plan: "Revert commit.",
    };

    const result = parseStructuredReport(JSON.stringify(payload));
    expect(result.kind).toBe("structured");
    if (result.kind !== "structured") return;

    expect(result.report.categories).toHaveLength(13);
    expect(result.report.categories.map((c) => c.id)).toEqual(CANONICAL_IDS);
    expect(result.report.categories[0]?.score).toBe(9);
    expect(result.report.categories[6]?.score).toBe(6);
    expect(result.report.categories[12]?.score).toBe(10);
  });

  it("strips fenced JSON blocks", () => {
    const payload = {
      overview: "Fenced report",
      categories: CANONICAL_IDS.map((id) => makeCategoryPayload(id, 8)),
      blast_radius: "Single service.",
      deployment_risks: "None.",
      rollback_plan: "Standard rollback.",
    };
    const fenced = `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;

    const result = parseStructuredReport(fenced);
    expect(result.kind).toBe("structured");
    if (result.kind !== "structured") return;

    expect(result.report.overview).toBe("Fenced report");
    expect(result.report.categories).toHaveLength(13);
  });

  it("clamps scores to 1..10", () => {
    const payload = {
      overview: "Clamped scores",
      categories: [
        makeCategoryPayload("encapsulation", 0),
        makeCategoryPayload("idempotency", -5),
        makeCategoryPayload("edge_cases", 15),
        makeCategoryPayload("error_handling", 7.6),
      ],
      blast_radius: "Minimal.",
      deployment_risks: "Minimal.",
      rollback_plan: "Revert.",
    };

    const result = parseStructuredReport(JSON.stringify(payload));
    expect(result.kind).toBe("structured");
    if (result.kind !== "structured") return;

    expect(result.report.categories[0]?.score).toBe(1);
    expect(result.report.categories[1]?.score).toBe(1);
    expect(result.report.categories[2]?.score).toBe(10);
    expect(result.report.categories[3]?.score).toBe(8);
  });

  it("preserves test_coverage and dependencies metadata fields", () => {
    const payload = {
      overview: "Metadata check",
      categories: CANONICAL_IDS.map((id) => makeCategoryPayload(id, 8)),
      blast_radius: "Billing.",
      deployment_risks: "Low.",
      rollback_plan: "Revert.",
    };

    const result = parseStructuredReport(JSON.stringify(payload));
    expect(result.kind).toBe("structured");
    if (result.kind !== "structured") return;

    const coverage = result.report.categories.find((c) => c.id === "test_coverage");
    expect(coverage?.coveragePercent).toBe(72);
    expect(coverage?.testScenarios).toEqual([
      "Valid ISO-4217 currency export",
      "Null currency fallback",
    ]);

    const deps = result.report.categories.find((c) => c.id === "dependencies");
    expect(deps?.dependenciesIntroduced).toBe(false);
    expect(deps?.dependencyTradeoff).toBe(
      "No new dependencies were introduced; avoids supply-chain overhead.",
    );
  });

  it("falls back to legacy markdown on plain Markdown or partial JSON", () => {
    const markdown = "## Branch review\n\nFound 1 warning.";
    expect(parseStructuredReport(markdown)).toEqual({
      kind: "legacy",
      markdown,
    });

    const partialJson = '{"overview": "Streaming in progress", "categories": [{"id": "encap';
    expect(parseStructuredReport(partialJson)).toEqual({
      kind: "legacy",
      markdown: partialJson,
    });
  });
});
