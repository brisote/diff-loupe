import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../lib/icon";
import { MarkdownDocument } from "../markdown-diff/MarkdownDocument";
import {
  CANONICAL_CATEGORIES,
  type CategoryId,
  formatStructuredReportAsMarkdown,
  parseStructuredReport,
  scoreTier,
} from "./structuredReport";

type ReportViewerProps = {
  markdown: string;
  onAskSelection: (selection: { text: string; heading?: string }) => void;
  isStreamingInitial?: boolean;
  reviewIdentity?: string | number | null;
};

type FloatingAction = {
  top: number;
  left: number;
  text: string;
  heading?: string;
};

const GAUGE_RADIUS = 18;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

function withUniqueKeys<T>(
  items: T[],
  getBaseKey: (item: T) => string,
): Array<{ key: string; item: T }> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = getBaseKey(item);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { key: `${base}-${count}`, item };
  });
}

export const ReportViewer = memo(function ReportViewer({
  markdown,
  onAskSelection,
  isStreamingInitial = false,
  reviewIdentity = null,
}: ReportViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const copySeqRef = useRef(0);
  const [floating, setFloating] = useState<FloatingAction | null>(null);
  const [selectedId, setSelectedId] = useState<CategoryId | null>(null);
  const [copied, setCopied] = useState(false);

  const parsed = useMemo(() => {
    if (isStreamingInitial) {
      const trimmed = markdown.trimStart();
      if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("```")) {
        return { kind: "legacy" as const, markdown };
      }
    }
    return parseStructuredReport(markdown);
  }, [isStreamingInitial, markdown]);

  const prevReviewIdentityRef = useRef(reviewIdentity);
  const prevMarkdownRef = useRef(markdown);

  const clearCopyTimer = useCallback(() => {
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      copySeqRef.current += 1;
      clearCopyTimer();
    };
  }, [clearCopyTimer]);

  useEffect(() => {
    if (prevReviewIdentityRef.current !== reviewIdentity) {
      prevReviewIdentityRef.current = reviewIdentity;
      copySeqRef.current += 1;
      clearCopyTimer();
      setSelectedId(null);
      setFloating(null);
      setCopied(false);
    }
  }, [reviewIdentity, clearCopyTimer]);

  useEffect(() => {
    if (prevMarkdownRef.current !== markdown) {
      prevMarkdownRef.current = markdown;
      copySeqRef.current += 1;
      clearCopyTimer();
      setFloating(null);
      setCopied(false);
    }
  }, [markdown, clearCopyTimer]);

  useEffect(() => {
    if (parsed.kind === "legacy") {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) =>
      prev && parsed.report.categories.some((cat) => cat.id === prev) ? prev : null,
    );
  }, [parsed]);

  const updateSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setFloating(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const container = containerRef.current;
    if (!container?.contains(range.commonAncestorContainer)) {
      setFloating(null);
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      setFloating(null);
      return;
    }

    let heading: string | undefined;
    const node: Node | null = range.startContainer;
    let el: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement;
    while (el && el !== container) {
      if (/^H[1-6]$/i.test(el.tagName)) {
        heading = el.textContent?.trim();
        break;
      }
      let prev = el.previousElementSibling;
      while (prev) {
        if (/^H[1-6]$/i.test(prev.tagName)) {
          heading = prev.textContent?.trim();
          break;
        }
        const nested = prev.querySelector("h1, h2, h3, h4, h5, h6");
        if (nested) {
          heading = nested.textContent?.trim();
          break;
        }
        prev = prev.previousElementSibling;
      }
      if (heading) break;
      el = el.parentElement;
    }

    const rangeRect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    let top = rangeRect.top - containerRect.top - 36;
    if (top < 4) {
      top = rangeRect.bottom - containerRect.top + 6;
    }

    const pillWidth = 270;
    let left = rangeRect.left - containerRect.left + rangeRect.width / 2 - pillWidth / 2;
    const minLeft = 8;
    const maxLeft = Math.max(minLeft, container.clientWidth - pillWidth - 8);
    left = Math.max(minLeft, Math.min(left, maxLeft));

    setFloating({
      top,
      left,
      text,
      heading,
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    document.addEventListener("selectionchange", updateSelection);
    window.addEventListener("resize", updateSelection);

    const observer = new ResizeObserver(updateSelection);
    observer.observe(container);

    return () => {
      document.removeEventListener("selectionchange", updateSelection);
      window.removeEventListener("resize", updateSelection);
      observer.disconnect();
    };
  }, [updateSelection]);

  const handleCopyMarkdown = async () => {
    if (parsed.kind !== "structured") return;
    const seq = ++copySeqRef.current;
    try {
      await navigator.clipboard.writeText(formatStructuredReportAsMarkdown(parsed.report));
      if (!mountedRef.current || copySeqRef.current !== seq) return;
      setCopied(true);
      clearCopyTimer();
      copyTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current && copySeqRef.current === seq) {
          setCopied(false);
        }
      }, 2000);
    } catch {
      if (mountedRef.current && copySeqRef.current === seq) {
        setCopied(false);
      }
    }
  };

  const floatingPill = floating ? (
    <div className="dl-ai-float-action" style={{ top: floating.top, left: floating.left }}>
      <button
        className="dl-ai-action-btn"
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onAskSelection({ text: floating.text, heading: floating.heading });
          setFloating(null);
        }}
      >
        <Icon name="diff-magicResolveToolbar" />
        <span>Ask about selection</span>
      </button>
      <span style={{ color: "var(--border)" }}>|</span>
      <button
        className="dl-ai-action-btn"
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onAskSelection({ text: floating.text, heading: floating.heading });
          setFloating(null);
        }}
      >
        <span>Request more data</span>
      </button>
    </div>
  ) : null;

  if (isStreamingInitial && parsed.kind !== "structured") {
    return (
      <div
        ref={containerRef}
        style={{
          position: "relative",
          maxWidth: 920,
          width: "100%",
          margin: "0 auto",
        }}
      >
        <output
          className="dl-ai-report-card dl-ai-skeleton"
          aria-busy="true"
          aria-label="Loading review report"
        >
          <div className="dl-ai-skeleton-line" style={{ width: "60%" }} />
          <div className="dl-ai-skeleton-line" style={{ width: "38%" }} />
          <div className="dl-ai-skeleton-grid">
            {CANONICAL_CATEGORIES.map((cat) => (
              <div key={cat.id} className="dl-ai-skeleton-tile" />
            ))}
          </div>
        </output>
      </div>
    );
  }

  if (parsed.kind === "legacy") {
    return (
      <div
        ref={containerRef}
        className="dl-md"
        style={{ position: "relative", maxWidth: 820, width: "100%", margin: "0 auto" }}
      >
        <MarkdownDocument markdown={parsed.markdown} />
        {floatingPill}
      </div>
    );
  }

  const { report } = parsed;
  const selectedCategory = selectedId
    ? (report.categories.find((cat) => cat.id === selectedId) ?? null)
    : null;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        maxWidth: 920,
        width: "100%",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div className="dl-ai-report-card">
        <div className="dl-ai-report-head">
          <div className="dl-ai-report-title">{report.overview}</div>
          <button
            type="button"
            className="dl-btn dl-btn-sm"
            onClick={() => void handleCopyMarkdown()}
          >
            <Icon name="general-copy" />
            <span>{copied ? "Copied" : "Copy as Markdown"}</span>
          </button>
        </div>

        <fieldset
          className="dl-ai-gauges"
          aria-label="Review categories"
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
          {report.categories.map((cat) => {
            const isSelected = selectedId === cat.id;
            const tier = scoreTier(cat.score);
            const dashOffset =
              cat.score !== null ? GAUGE_CIRCUMFERENCE * (1 - cat.score / 10) : GAUGE_CIRCUMFERENCE;
            const metaText =
              cat.id === "test_coverage" && cat.coveragePercent !== null
                ? `${cat.coveragePercent}% cov`
                : `${cat.problems.length} ${cat.problems.length === 1 ? "issue" : "issues"}`;

            return (
              <button
                key={cat.id}
                type="button"
                className={`dl-ai-gauge-btn ${isSelected ? "is-selected" : ""}`}
                aria-expanded={isSelected}
                onClick={() => setSelectedId(isSelected ? null : cat.id)}
              >
                <span className={`dl-ai-gauge-ring is-${tier}`}>
                  <svg viewBox="0 0 44 44" aria-hidden="true">
                    <circle className="dl-ai-gauge-bg" cx="22" cy="22" r={GAUGE_RADIUS} />
                    <circle
                      className="dl-ai-gauge-arc"
                      cx="22"
                      cy="22"
                      r={GAUGE_RADIUS}
                      strokeDasharray={GAUGE_CIRCUMFERENCE}
                      strokeDashoffset={dashOffset}
                    />
                  </svg>
                  <span className="dl-ai-gauge-score">{cat.score !== null ? cat.score : "?"}</span>
                </span>
                <span className="dl-ai-gauge-label">{cat.title}</span>
                <span className="dl-ai-gauge-meta">{metaText}</span>
              </button>
            );
          })}
        </fieldset>

        {selectedCategory && (
          <section className="dl-ai-cat-detail" aria-label="Selected category details">
            <div className="dl-ai-cat-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="dl-ai-cat-title">{selectedCategory.title}</span>
                <span className="dl-ai-pill dl-ai-pill-muted">
                  {selectedCategory.score !== null
                    ? `Score ${selectedCategory.score}/10`
                    : "Unscored"}
                </span>
              </div>
              <button
                className="dl-btn dl-btn-sm"
                type="button"
                onClick={() =>
                  onAskSelection({
                    text: selectedCategory.summary || selectedCategory.title,
                    heading: selectedCategory.title,
                  })
                }
              >
                Ask about category
              </button>
            </div>

            {selectedCategory.summary && (
              <p className="dl-ai-cat-summary">{selectedCategory.summary}</p>
            )}

            {selectedCategory.id === "test_coverage" && (
              <>
                {selectedCategory.coveragePercent !== null && (
                  <div className="dl-ai-cat-meta">
                    <span>Test coverage for changed code: {selectedCategory.coveragePercent}%</span>
                  </div>
                )}
                {selectedCategory.testScenarios.length > 0 && (
                  <ul className="dl-ai-problem-list">
                    {withUniqueKeys(selectedCategory.testScenarios, (s) => s).map(
                      ({ key, item: scenario }) => (
                        <li key={key} className="dl-ai-problem-item">
                          {scenario}
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </>
            )}

            {selectedCategory.id === "dependencies" &&
              (selectedCategory.dependenciesIntroduced !== null ||
                selectedCategory.dependencyTradeoff) && (
                <div className="dl-ai-cat-meta">
                  {selectedCategory.dependenciesIntroduced !== null && (
                    <span>
                      New dependency introduced:{" "}
                      {selectedCategory.dependenciesIntroduced ? "Yes" : "No"}
                    </span>
                  )}
                  {selectedCategory.dependencyTradeoff && (
                    <span>{selectedCategory.dependencyTradeoff}</span>
                  )}
                </div>
              )}

            <ul className="dl-ai-problem-list">
              {selectedCategory.problems.length === 0 ? (
                <li className="dl-ai-problem-item">No problems found in this category.</li>
              ) : (
                withUniqueKeys(
                  selectedCategory.problems,
                  (problem) => `${problem.title}-${problem.location ?? ""}`,
                ).map(({ key, item: problem }) => {
                  const normalizedSeverity = problem.severity?.toLowerCase();
                  const severityClass =
                    normalizedSeverity === "high" ||
                    normalizedSeverity === "medium" ||
                    normalizedSeverity === "low"
                      ? ` is-${normalizedSeverity}`
                      : "";
                  const hasDistinctDescription =
                    Boolean(problem.description) && problem.description !== problem.title;

                  return (
                    <li key={key} className="dl-ai-problem-item">
                      <div className="dl-ai-problem-head">
                        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                          {problem.severity && (
                            <span className={`dl-ai-severity${severityClass}`}>
                              {problem.severity}
                            </span>
                          )}
                          <button
                            type="button"
                            className="dl-ai-action-btn"
                            style={{
                              padding: 0,
                              height: "auto",
                              fontWeight: 600,
                              textAlign: "left",
                            }}
                            onClick={() =>
                              onAskSelection({
                                text: `${problem.title}${problem.location ? ` (${problem.location})` : ""}${hasDistinctDescription ? `: ${problem.description}` : ""}`,
                                heading: selectedCategory.title,
                              })
                            }
                          >
                            {problem.title}
                          </button>
                        </div>
                        {problem.location && <code>{problem.location}</code>}
                      </div>
                      {hasDistinctDescription && <div>{problem.description}</div>}
                    </li>
                  );
                })
              )}
            </ul>
          </section>
        )}
      </div>

      <div className="dl-ai-ops-md">
        <h3>Blast radius</h3>
        <MarkdownDocument markdown={report.blastRadius.trim() || "None reported."} />
        <h3>Deployment risks</h3>
        <MarkdownDocument markdown={report.deploymentRisks.trim() || "None reported."} />
        <h3>Rollback plan</h3>
        <MarkdownDocument markdown={report.rollbackPlan.trim() || "None reported."} />
      </div>
      {floatingPill}
    </div>
  );
});
