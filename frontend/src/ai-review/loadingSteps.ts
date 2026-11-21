export const FINAL_LOADING_STEP = "Building the view";

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

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pickLoadingSequence(seed: string, count = 24): string[] {
  const first = REVIEW_LOADING_LABELS[0];
  const rest = REVIEW_LOADING_LABELS.slice(1);
  let state = hashSeed(seed) || 1;
  for (let i = rest.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    const tmp = rest[i];
    const swap = rest[j];
    if (tmp !== undefined && swap !== undefined) {
      rest[i] = swap;
      rest[j] = tmp;
    }
  }
  const limit = Math.max(1, Math.min(count, REVIEW_LOADING_LABELS.length));
  return first ? [first, ...rest.slice(0, limit - 1)] : rest.slice(0, limit);
}
