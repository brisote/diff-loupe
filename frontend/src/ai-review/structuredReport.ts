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
  score: number;
  summary: string;
  problems: CategoryProblem[];
  coveragePercent?: number;
  testScenarios?: string[];
  dependenciesIntroduced?: boolean;
  dependencyTradeoff?: string;
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

const CANONICAL_CATEGORIES: ReadonlyArray<{ id: CategoryId; title: string }> = [
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

export function scoreTier(score: number): "good" | "warn" | "bad" {
  if (score >= 8) return "good";
  if (score >= 5) return "warn";
  return "bad";
}

function clampScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 8;
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

function normalizeStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items = raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return items.length > 0 ? items : [];
}

export function parseStructuredReport(raw: string): ParsedReviewReport {
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

  if (typeof parsed.overview !== "string" || !Array.isArray(parsed.categories)) {
    return { kind: "legacy", markdown: raw };
  }

  const byId = new Map<string, Record<string, unknown>>();
  for (const item of parsed.categories) {
    if (isRecord(item) && typeof item.id === "string") {
      byId.set(item.id, item);
    }
  }

  const categories: CategoryAssessment[] = CANONICAL_CATEGORIES.map(({ id, title }) => {
    const entry = byId.get(id);
    if (!entry) {
      return {
        id,
        title,
        score: 8,
        summary: "No issues reported.",
        problems: [],
      };
    }

    const assessment: CategoryAssessment = {
      id,
      title: typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : title,
      score: clampScore(entry.score),
      summary: typeof entry.summary === "string" ? entry.summary.trim() : "",
      problems: normalizeProblems(entry.problems),
    };

    if (id === "test_coverage") {
      const cov = entry.coverage_percent ?? entry.coveragePercent;
      if (typeof cov === "number" && Number.isFinite(cov)) {
        assessment.coveragePercent = Math.max(0, Math.min(100, Math.round(cov)));
      }
      const scenarios = normalizeStringArray(entry.test_scenarios ?? entry.testScenarios);
      if (scenarios !== undefined) {
        assessment.testScenarios = scenarios;
      }
    }

    if (id === "dependencies") {
      const introduced = entry.dependencies_introduced ?? entry.dependenciesIntroduced;
      if (typeof introduced === "boolean") {
        assessment.dependenciesIntroduced = introduced;
      }
      const tradeoff = entry.dependency_tradeoff ?? entry.dependencyTradeoff;
      if (typeof tradeoff === "string" && tradeoff.trim()) {
        assessment.dependencyTradeoff = tradeoff.trim();
      }
    }

    return assessment;
  });

  const schemaVersion =
    typeof parsed.schema_version === "number"
      ? parsed.schema_version
      : typeof parsed.schemaVersion === "number"
        ? parsed.schemaVersion
        : 1;

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
