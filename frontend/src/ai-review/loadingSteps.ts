export const FINAL_LOADING_STEP = "Building the view";

export const LOADING_LABEL_INTERVAL_MS = 8000;

export const MAJOR_REVIEW_STEPS: readonly string[] = [
  "Preparing repository snapshot and diff",
  "Analyzing repository structure and conventions",
  "Reviewing branch changes",
  FINAL_LOADING_STEP,
];

export function majorStepIndexForStage(stage: string, hasStreamingReport: boolean): number {
  if (hasStreamingReport || stage === "writing" || stage === "formatting") {
    return 3;
  }
  if (
    stage === "reviewing" ||
    stage === "review" ||
    stage === "thinking" ||
    stage === "analysis" ||
    stage === "analyzing"
  ) {
    return 2;
  }
  if (stage === "memory" || stage === "indexing") {
    return 1;
  }
  return 0;
}

const VERBS: readonly string[] = [
  "Reviewing",
  "Inspecting",
  "Checking",
  "Evaluating",
  "Tracing",
  "Auditing",
  "Analyzing",
  "Verifying",
  "Assessing",
  "Examining",
];

const TOPICS: readonly string[] = [
  "changed modules",
  "control flow",
  "error handling",
  "boundary conditions",
  "state transitions",
  "data transformations",
  "public interfaces",
  "internal abstractions",
  "dependency boundaries",
  "concurrency safety",
  "resource cleanup",
  "input validation",
  "failure recovery",
  "edge cases",
  "test coverage",
  "performance characteristics",
  "backward compatibility",
  "configuration handling",
  "logging behavior",
  "security boundaries",
];

const QUALIFIERS: readonly string[] = [
  "across modified files",
  "in the branch diff",
  "against existing invariants",
  "for subtle regressions",
  "for consistency and clarity",
];

export const REVIEW_LOADING_LABELS: readonly string[] = VERBS.flatMap((verb) =>
  TOPICS.flatMap((topic) => QUALIFIERS.map((qualifier) => `${verb} ${topic} ${qualifier}`)),
);

export function pickRandomLoadingLabel(previous?: string): string {
  const count = REVIEW_LOADING_LABELS.length;
  if (count === 0) return FINAL_LOADING_STEP;
  if (count === 1) return REVIEW_LOADING_LABELS[0] ?? FINAL_LOADING_STEP;
  let next = REVIEW_LOADING_LABELS[Math.floor(Math.random() * count)] ?? FINAL_LOADING_STEP;
  if (next === previous) {
    const idx = REVIEW_LOADING_LABELS.indexOf(next);
    next = REVIEW_LOADING_LABELS[(idx + 1) % count] ?? FINAL_LOADING_STEP;
  }
  return next;
}
