export const FINAL_LOADING_STEP = "Building the view";

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

export const REVIEW_LOADING_LABELS: readonly string[] = [
  "Preparing repository snapshot and diff",
  "Indexing modified files and hunks",
  "Mapping branch commits against target base",
  "Inspecting repository layout and module boundaries",
  "Checking file renames and deleted paths",
  "Scanning diff for public API surface changes",
  "Tracing imports and cross-module dependencies",
  "Reviewing encapsulation and visibility modifiers",
  "Evaluating abstraction boundaries across layers",
  "Checking for leaked internal state",
  "Inspecting helper reuse and duplication",
  "Auditing configuration and environment loading",
  "Checking idempotency of state transitions",
  "Tracing repeated action and retry paths",
  "Inspecting cache invalidation and refresh logic",
  "Reviewing keyboard and pointer event propagation",
  "Checking empty and null input handling",
  "Validating boundary conditions and numeric limits",
  "Checking Unicode and multi-byte string indexing",
  "Inspecting CRLF and LF line-ending handling",
  "Checking binary and oversized file guards",
  "Reviewing malformed payload fallback paths",
  "Checking symlink and path traversal boundaries",
  "Auditing filesystem error propagation",
  "Inspecting typed error variants and status codes",
  "Checking silent failure and swallowed catch blocks",
  "Reviewing subprocess exit code handling",
  "Inspecting timeout and pipe-buffer safety",
  "Checking user-facing error messages and notices",
  "Reviewing diagnostic logging and redaction rules",
  "Checking for sensitive data in log output",
  "Inspecting command telemetry and timing hooks",
  "Auditing authentication and credential storage",
  "Checking file permissions on sensitive artifacts",
  "Reviewing command argument escaping and shell safety",
  "Checking untrusted input sanitization",
  "Inspecting network boundaries and origin checks",
  "Reviewing async request sequencing and cancellation",
  "Checking for stale response race conditions",
  "Inspecting effect cleanup and listener disposal",
  "Auditing shared mutable state and locking",
  "Checking thread safety and background task lifecycles",
  "Reviewing database transactions and atomicity",
  "Checking schema migrations and backward compatibility",
  "Inspecting partial-write and rollback behavior",
  "Checking crash recovery and durable state writes",
  "Analyzing hot-loop allocations and CPU overhead",
  "Checking memory caps on large repository scans",
  "Inspecting list virtualization and render frequency",
  "Checking redundant UI dispatches and reflows",
  "Reviewing bundle size and eager imports",
  "Evaluating startup latency and lazy loading",
  "Checking wire contract and DTO compatibility",
  "Inspecting serialized JSON field names and defaults",
  "Reviewing CLI flags and script compatibility",
  "Checking breaking changes for existing callers",
  "Auditing unit test coverage on changed modules",
  "Checking integration tests against real repositories",
  "Reviewing end-to-end UI test assertions",
  "Checking edge-case assertions in test suites",
  "Inspecting mock fidelity against production contracts",
  "Auditing newly added packages and transitive trees",
  "Checking license and maintenance risk of dependencies",
  "Weighing dependency footprint against custom code",
  "Inspecting git status and ignored-file filtering",
  "Checking merge-conflict and unmerged index handling",
  "Reviewing diff hunk alignment and line offsets",
  "Inspecting syntax highlighting and language loaders",
  "Checking scroll synchronization and viewport jumps",
  "Reviewing focus management and keyboard navigation",
  "Checking accessible labels and ARIA roles",
  "Inspecting light and dark theme token usage",
  "Checking layout responsiveness on window resize",
  "Reviewing dialog, popup, and overlay dismissal",
  "Inspecting state persistence across repository switches",
  "Checking branch switch and watcher refresh behavior",
  "Reviewing dead code and leftover debug artifacts",
  "Checking strict type safety and narrowing",
  "Inspecting unchecked indexing and unwrap calls",
  "Reviewing regular expressions for backtracking risk",
  "Checking date, time, and locale assumptions",
  "Inspecting floating-point and currency precision",
  "Checking pagination, truncation, and result caps",
  "Reviewing sorting stability and tie-breakers",
  "Inspecting stream buffering and chunk boundaries",
  "Checking backpressure and bounded channel limits",
  "Reviewing retry backoff and failure recovery",
  "Assessing blast radius across downstream callers",
  "Evaluating deployment and rollout risk factors",
  "Drafting safe rollback and verification steps",
  "Grouping findings by engineering category",
  "Scoring encapsulation and architectural clarity",
  "Scoring reliability and error resilience",
  "Scoring security posture and input containment",
  "Scoring concurrency and race-condition safety",
  "Scoring performance and resource bounds",
  "Ranking high, medium, and low severity issues",
  "Verifying file and line references for findings",
  "Cross-checking test coverage estimates",
  "Finalizing structured review summary",
];

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
