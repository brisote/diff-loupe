import { describe, expect, it, vi } from "vitest";
import {
  formatStructuredReportAsMarkdown,
  parseStructuredReport,
  scoreTier,
  truncateWords,
} from "./structuredReport";

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

  it("maps null or invalid scores to unknown", () => {
    expect(scoreTier(null)).toBe("unknown");
    expect(scoreTier(Number.NaN)).toBe("unknown");
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
    expect(result.report.categories[1]?.score).toBeNull();
    expect(result.report.categories[1]?.summary).toBe("");
    expect(result.report.categories[6]?.score).toBe(6);
    expect(result.report.categories[11]?.coveragePercent).toBeNull();
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

  it("represents missing or invalid scores and metadata explicitly as null", () => {
    const payload = {
      schema_version: 1,
      overview: "Missing fields check",
      categories: [
        { id: "encapsulation", title: "Encapsulation", score: "invalid", summary: "Unclear." },
        { id: "test_coverage", title: "Test coverage", summary: "Not measured." },
        { id: "dependencies", title: "New dependencies", score: 8, summary: "Unchecked." },
      ],
      blast_radius: "Minimal.",
      deployment_risks: "Minimal.",
      rollback_plan: "Revert.",
    };

    const result = parseStructuredReport(JSON.stringify(payload));
    expect(result.kind).toBe("structured");
    if (result.kind !== "structured") return;

    expect(result.report.categories[0]?.score).toBeNull();
    const coverage = result.report.categories.find((c) => c.id === "test_coverage");
    expect(coverage?.score).toBeNull();
    expect(coverage?.coveragePercent).toBeNull();
    const deps = result.report.categories.find((c) => c.id === "dependencies");
    expect(deps?.dependenciesIntroduced).toBeNull();
  });

  it("falls back to legacy without calling console.warn on empty, non-canonical, or unsupported schema_version", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const emptyCategories = JSON.stringify({
        schema_version: 1,
        overview: "Empty categories",
        categories: [],
      });
      expect(parseStructuredReport(emptyCategories)).toEqual({
        kind: "legacy",
        markdown: emptyCategories,
      });

      const nonCanonicalCategories = JSON.stringify({
        schema_version: 1,
        overview: "Non-canonical categories",
        categories: [
          {
            id: "custom_unknown_category",
            title: "Custom",
            score: 8,
            summary: "Unknown id.",
            problems: [],
          },
        ],
      });
      expect(parseStructuredReport(nonCanonicalCategories)).toEqual({
        kind: "legacy",
        markdown: nonCanonicalCategories,
      });

      const unsupportedVersion = JSON.stringify({
        schema_version: 2,
        overview: "Future schema",
        categories: [makeCategoryPayload("encapsulation", 9)],
      });
      expect(parseStructuredReport(unsupportedVersion)).toEqual({
        kind: "legacy",
        markdown: unsupportedVersion,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("truncateWords", () => {
  it("clamps titles to at most 10 words", () => {
    expect(truncateWords("Short branch review title", 10)).toBe("Short branch review title");
    const longTitle = "one two three four five six seven eight nine ten eleven twelve";
    const clamped = truncateWords(longTitle, 10);
    expect(clamped.split(/\s+/).length).toBeLessThanOrEqual(10);
    expect(clamped).toContain("one");
    expect(clamped).toContain("ten");
    expect(clamped).not.toContain("eleven");
    expect(clamped).not.toContain("twelve");
  });
});

describe("formatStructuredReportAsMarkdown", () => {
  it("collapses overview newlines and exports only the first section without operational sections", () => {
    const payload = {
      schema_version: 1,
      overview: "Branch review:\ninvoice export\n\ncurrency support",
      categories: [
        makeCategoryPayload("encapsulation", 9),
        makeCategoryPayload("test_coverage", 6),
        makeCategoryPayload("dependencies", 10),
      ],
      blast_radius: "Affects invoice export endpoints.",
      deployment_risks: "Consumers must tolerate the currency column.",
      rollback_plan: "Revert the commit.",
    };

    const parsed = parseStructuredReport(JSON.stringify(payload));
    expect(parsed.kind).toBe("structured");
    if (parsed.kind !== "structured") return;

    const md = formatStructuredReportAsMarkdown(parsed.report);
    expect(md).toContain("Branch review: invoice export currency support");
    expect(md).not.toContain("Branch review:\ninvoice export");
    expect(md).toContain("Test coverage");
    expect(md).toContain("Missing negative amount test");
    expect(md).toContain("billing/InvoiceExporterTest.kt:44");
    expect(md).not.toContain("Blast radius");
    expect(md).not.toContain("Deployment risks");
    expect(md).not.toContain("Rollback plan");
    expect(md).not.toContain("Affects invoice export endpoints.");
    expect(md).not.toContain("Consumers must tolerate the currency column.");
    expect(md).not.toContain("Revert the commit.");
  });
});
