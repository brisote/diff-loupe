export type CategoryId =
  | "encapsulation"
  | "idempotency"
  | "edge_cases"
  | "error_handling"
  | "logs"
  | "monitoring"
  | "security"
  | "concurrency"
  | "transactions"
  | "performance"
  | "breaking_changes"
  | "test_coverage"
  | "dependencies";

export type CategoryProblem = {
  title: string;
  description: string;
  location?: string;
  severity?: string;
};

export type CategoryAssessment = {
  id: CategoryId;
  title: string;
  score: number | null;
  summary: string;
  problems: CategoryProblem[];
  coveragePercent: number | null;
  testScenarios: string[];
  dependenciesIntroduced: boolean | null;
  dependencyTradeoff: string | null;
};

export type StructuredReviewReport = {
  schemaVersion: number;
  overview: string;
  categories: CategoryAssessment[];
  blastRadius: string;
  deploymentRisks: string;
  rollbackPlan: string;
};

export type ParsedReviewReport =
  | { kind: "structured"; report: StructuredReviewReport }
  | { kind: "legacy"; markdown: string };

export const CANONICAL_CATEGORIES: ReadonlyArray<{ id: CategoryId; title: string }> = [
  { id: "encapsulation", title: "Encapsulation" },
  { id: "idempotency", title: "Idempotency" },
  { id: "edge_cases", title: "Edge cases & inputs" },
  { id: "error_handling", title: "Error handling" },
  { id: "logs", title: "Logs" },
  { id: "monitoring", title: "Monitoring" },
  { id: "security", title: "Security" },
  { id: "concurrency", title: "Concurrency" },
  { id: "transactions", title: "Transactions & atomicity" },
  { id: "performance", title: "Performance" },
  { id: "breaking_changes", title: "Breaking changes" },
  { id: "test_coverage", title: "Test coverage" },
  { id: "dependencies", title: "New dependencies" },
];

export function scoreTier(score: number | null): "good" | "warn" | "bad" | "unknown" {
  if (score === null || !Number.isFinite(score)) return "unknown";
  if (score >= 8) return "good";
  if (score >= 5) return "warn";
  return "bad";
}

function clampScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(1, Math.min(10, Math.round(value)));
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const match = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n?```$/i.exec(trimmed);
  return match?.[1] ? match[1].trim() : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProblems(raw: unknown): CategoryProblem[] {
  if (!Array.isArray(raw)) return [];
  const problems: CategoryProblem[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim() : "";
    if (!title && !description) continue;
    const problem: CategoryProblem = {
      title: title || description,
      description,
    };
    if (typeof item.location === "string" && item.location.trim()) {
      problem.location = item.location.trim();
    }
    if (typeof item.severity === "string" && item.severity.trim()) {
      problem.severity = item.severity.trim();
    }
    problems.push(problem);
  }
  return problems;
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

export function parseStructuredReport(raw: string): ParsedReviewReport {
  if (typeof raw !== "string") {
    return { kind: "legacy", markdown: "" };
  }
  const candidate = stripJsonFence(raw);
  if (!candidate.startsWith("{")) {
    return { kind: "legacy", markdown: raw };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { kind: "legacy", markdown: raw };
  }

  if (!isRecord(parsed)) {
    return { kind: "legacy", markdown: raw };
  }

  const rawVersion = parsed.schema_version ?? parsed.schemaVersion;
  if (rawVersion !== undefined && rawVersion !== 1) {
    return { kind: "legacy", markdown: raw };
  }

  if (
    typeof parsed.overview !== "string" ||
    !Array.isArray(parsed.categories) ||
    parsed.categories.length === 0
  ) {
    return { kind: "legacy", markdown: raw };
  }

  const byId = new Map<string, Record<string, unknown>>();
  for (const item of parsed.categories) {
    if (isRecord(item) && typeof item.id === "string") {
      byId.set(item.id, item);
    }
  }

  if (!CANONICAL_CATEGORIES.some(({ id }) => byId.has(id))) {
    return { kind: "legacy", markdown: raw };
  }

  const categories: CategoryAssessment[] = CANONICAL_CATEGORIES.map(({ id, title }) => {
    const entry = byId.get(id);
    if (!entry) {
      return {
        id,
        title,
        score: null,
        summary: "",
        problems: [],
        coveragePercent: null,
        testScenarios: [],
        dependenciesIntroduced: null,
        dependencyTradeoff: null,
      };
    }

    const cov = entry.coverage_percent ?? entry.coveragePercent;
    const coveragePercent =
      id === "test_coverage" && typeof cov === "number" && Number.isFinite(cov)
        ? Math.max(0, Math.min(100, Math.round(cov)))
        : null;

    const testScenarios =
      id === "test_coverage"
        ? normalizeStringArray(entry.test_scenarios ?? entry.testScenarios)
        : [];

    const introduced = entry.dependencies_introduced ?? entry.dependenciesIntroduced;
    const dependenciesIntroduced =
      id === "dependencies" && typeof introduced === "boolean" ? introduced : null;

    const tradeoff = entry.dependency_tradeoff ?? entry.dependencyTradeoff;
    const dependencyTradeoff =
      id === "dependencies" && typeof tradeoff === "string" && tradeoff.trim()
        ? tradeoff.trim()
        : null;

    return {
      id,
      title: typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : title,
      score: clampScore(entry.score),
      summary: typeof entry.summary === "string" ? entry.summary.trim() : "",
      problems: normalizeProblems(entry.problems),
      coveragePercent,
      testScenarios,
      dependenciesIntroduced,
      dependencyTradeoff,
    };
  });

  const schemaVersion = typeof rawVersion === "number" ? rawVersion : 1;

  const blastRadius =
    typeof parsed.blast_radius === "string"
      ? parsed.blast_radius
      : typeof parsed.blastRadius === "string"
        ? parsed.blastRadius
        : "";

  const deploymentRisks =
    typeof parsed.deployment_risks === "string"
      ? parsed.deployment_risks
      : typeof parsed.deploymentRisks === "string"
        ? parsed.deploymentRisks
        : "";

  const rollbackPlan =
    typeof parsed.rollback_plan === "string"
      ? parsed.rollback_plan
      : typeof parsed.rollbackPlan === "string"
        ? parsed.rollbackPlan
        : "";

  return {
    kind: "structured",
    report: {
      schemaVersion,
      overview: parsed.overview,
      categories,
      blastRadius,
      deploymentRisks,
      rollbackPlan,
    },
  };
}

export function truncateWords(text: string, maxWords: number): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized || maxWords <= 0) return "";
  const words = normalized.split(" ");
  if (words.length <= maxWords) return normalized;
  return words.slice(0, maxWords).join(" ");
}

export function formatStructuredReportAsMarkdown(report: StructuredReviewReport): string {
  const sections: string[] = [];

  const normalizedOverview = report.overview.trim().replace(/\s+/g, " ");
  if (normalizedOverview) {
    sections.push(`## ${normalizedOverview}`);
  }

  for (const cat of report.categories) {
    const scoreLabel = cat.score !== null ? `${cat.score}/10` : "Unscored";
    const lines: string[] = [`### ${cat.title} (${scoreLabel})`];

    if (cat.summary) {
      lines.push("", cat.summary);
    }

    if (cat.id === "test_coverage") {
      if (cat.coveragePercent !== null) {
        lines.push("", `- Test coverage: ${cat.coveragePercent}%`);
      }
      if (cat.testScenarios.length > 0) {
        lines.push("", "Test scenarios:");
        for (const scenario of cat.testScenarios) {
          lines.push(`- ${scenario}`);
        }
      }
    }

    if (cat.id === "dependencies") {
      if (cat.dependenciesIntroduced !== null) {
        lines.push(
          "",
          `- New dependencies introduced: ${cat.dependenciesIntroduced ? "Yes" : "No"}`,
        );
      }
      if (cat.dependencyTradeoff) {
        lines.push("", `- Dependency tradeoff: ${cat.dependencyTradeoff}`);
      }
    }

    if (cat.problems.length > 0) {
      lines.push("", "Problems:");
      for (const problem of cat.problems) {
        const severityPrefix = problem.severity ? `[${problem.severity}] ` : "";
        const locationSuffix = problem.location ? ` (${problem.location})` : "";
        const descriptionSuffix =
          problem.description && problem.description !== problem.title
            ? `: ${problem.description}`
            : "";
        lines.push(`- ${severityPrefix}**${problem.title}**${locationSuffix}${descriptionSuffix}`);
      }
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}
