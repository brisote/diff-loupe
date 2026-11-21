import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "../lib/dialog";
import { Icon } from "../lib/icon";
import { Popup, useBelow } from "../lib/popup";
import { TargetPicker } from "../main-window/TargetPicker";
import { useApp } from "../state/context";
import { isFollowupRunId, PENDING_REVIEW_ID } from "../state/store";
import { AiChatComposer } from "./AiChatComposer";
import { AiChatThread } from "./AiChatThread";
import {
  FINAL_LOADING_STEP,
  MAJOR_REVIEW_STEPS,
  majorStepIndexForStage,
  pickRandomLoadingLabel,
} from "./loadingSteps";
import { EffortPicker, ModelPicker } from "./ModelPicker";
import { formatBalanceUsd, formatReviewCostUsd } from "./money";
import { ReportViewer } from "./ReportViewer";

type DisplayReviewItem = {
  id: number;
  reviewNumber: number;
  branch: string;
  targetBranch: string;
  costUsd: string | null;
  createdAt: number;
  isPending?: boolean;
};

type ReviewPickerProps = {
  anchor: RefObject<HTMLElement | null>;
  reviews: DisplayReviewItem[];
  activeId: number | null;
  runningReviewId: number | null;
  canStartNew: boolean;
  onSelect: (id: number) => void;
  onNew: () => void;
  onClose: () => void;
};

function ReviewPicker({
  anchor,
  reviews,
  activeId,
  runningReviewId,
  canStartNew,
  onSelect,
  onNew,
  onClose,
}: ReviewPickerProps) {
  const style = useBelow(anchor, 320);

  return (
    <Popup
      label="Review history"
      role="menu"
      className="dl-popup app-review-picker"
      anchor={anchor}
      style={{ ...style, width: 320 }}
      onClose={onClose}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 8px 4px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span className="dl-popup-section" style={{ padding: 0 }}>
          Review history ({reviews.length})
        </span>
        <button
          className="dl-btn dl-btn-sm"
          type="button"
          disabled={!canStartNew}
          onClick={() => {
            onClose();
            onNew();
          }}
        >
          <Icon name="general-add" />
          New review
        </button>
      </div>
      <div className="dl-ai-history-list">
        {reviews.map((rev) => {
          const isSelected = rev.id === activeId;
          const isRunning =
            rev.isPending || (runningReviewId !== null && rev.id === runningReviewId);
          const cost = rev.costUsd ? formatReviewCostUsd(rev.costUsd) : "$0.00";
          const dateStr = rev.isPending
            ? "In progress"
            : new Date(rev.createdAt * 1000).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              });

          return (
            <button
              key={rev.id}
              type="button"
              className={`dl-row dl-ai-history-item ${isSelected ? "is-selected" : ""}`}
              onClick={() => {
                onSelect(rev.id);
                onClose();
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                }}
              >
                <span
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}
                >
                  <span>Review #{rev.reviewNumber}</span>
                  {isRunning && (
                    <span className="dl-ai-pulse-dot" aria-hidden="true" title="In progress" />
                  )}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{dateStr}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  fontSize: 12,
                  color: "var(--text-muted)",
                }}
              >
                <span>
                  {rev.branch} vs {rev.targetBranch}
                </span>
                <span>{rev.isPending ? "Generating…" : `Cost ${cost}`}</span>
              </div>
            </button>
          );
        })}
      </div>
    </Popup>
  );
}

export function AiReviewIsland() {
  const repo = useApp((state) => state.repo);
  const setWorkspaceMode = useApp((state) => state.setWorkspaceMode);
  const consentAccepted = useApp((state) => state.consentAccepted);
  const setAiConsent = useApp((state) => state.setAiConsent);
  const account = useApp((state) => state.account);
  const authPending = useApp((state) => state.authPending);
  const activeRun = useApp((state) => state.activeRun);
  const reportMarkdown = useApp((state) => state.reportMarkdown);
  const reviewCostUsd = useApp((state) => state.reviewCostUsd);
  const reviews = useApp((state) => state.reviews);
  const activeReviewId = useApp((state) => state.activeReviewId);
  const selectedVersionNumber = useApp((state) => state.selectedVersionNumber);
  const switchReview = useApp((state) => state.switchReview);
  const aiDeleteReview = useApp((state) => state.aiDeleteReview);
  const aiRevertVersion = useApp((state) => state.aiRevertVersion);
  const selectVersion = useApp((state) => state.selectVersion);
  const inlineError = useApp((state) => state.inlineError);
  const chatMessages = useApp((state) => state.chatMessages);
  const streamingChat = useApp((state) => state.streamingChat);
  const quotedSelection = useApp((state) => state.quotedSelection);
  const setQuotedSelection = useApp((state) => state.setQuotedSelection);
  const aiSendFollowup = useApp((state) => state.aiSendFollowup);
  const aiClearThread = useApp((state) => state.aiClearThread);
  const cancelTask = useApp((state) => state.cancelTask);
  const aiSignIn = useApp((state) => state.aiSignIn);
  const cancelAiSignIn = useApp((state) => state.cancelAiSignIn);
  const aiSignOut = useApp((state) => state.aiSignOut);
  const aiAddFunds = useApp((state) => state.aiAddFunds);
  const startAiReview = useApp((state) => state.startAiReview);
  const cancelAiReview = useApp((state) => state.cancelAiReview);
  const modelsCatalog = useApp((state) => state.modelsCatalog);
  const selectedModel = useApp((state) => state.selectedModel);
  const selectedEffort = useApp((state) => state.selectedEffort);
  const setSelectedModel = useApp((state) => state.setSelectedModel);
  const setSelectedEffort = useApp((state) => state.setSelectedEffort);

  const reviewAnchor = useRef<HTMLButtonElement>(null);
  const targetAnchor = useRef<HTMLButtonElement>(null);
  const modelAnchor = useRef<HTMLButtonElement>(null);
  const effortAnchor = useRef<HTMLButtonElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const thinkingRef = useRef<HTMLDivElement>(null);
  const prevReviewIdRef = useRef<number | null | undefined>(undefined);
  const prevMessageCountRef = useRef<number | null>(null);
  const [pickingReview, setPickingReview] = useState(false);
  const [pickingTarget, setPickingTarget] = useState(false);
  const [pickingModel, setPickingModel] = useState(false);
  const [pickingEffort, setPickingEffort] = useState(false);
  const [confirmRerun, setConfirmRerun] = useState(false);

  const isInitialStreaming = activeRun !== null && !isFollowupRunId(activeRun.runId);
  const isFollowupStreaming = isFollowupRunId(activeRun?.runId) || streamingChat !== null;
  const runningReviewId = activeRun
    ? (activeRun.reviewId ?? (isInitialStreaming ? PENDING_REVIEW_ID : activeReviewId))
    : null;
  const isViewingPendingReview =
    isInitialStreaming && (activeReviewId === PENDING_REVIEW_ID || activeReviewId === null);
  const isViewingFollowupRun =
    isFollowupStreaming && (runningReviewId === null || activeReviewId === runningReviewId);
  const isCurrentReviewBusy =
    isViewingPendingReview || (runningReviewId !== null && activeReviewId === runningReviewId);
  const activeStreamingChat = isViewingFollowupRun ? streamingChat : null;
  const composerDisabled =
    isInitialStreaming ||
    (!activeReviewId && chatMessages.length === 0) ||
    activeReviewId === PENDING_REVIEW_ID ||
    isFollowupStreaming;
  const initialRunId = isInitialStreaming ? (activeRun?.runId ?? null) : null;
  const stageStepIndex = isInitialStreaming
    ? majorStepIndexForStage(activeRun?.stage ?? "", Boolean(activeRun?.streamingReport))
    : 0;
  const [maxStepIndex, setMaxStepIndex] = useState(0);
  const [loadingLabel, setLoadingLabel] = useState(() => pickRandomLoadingLabel());

  useEffect(() => {
    if (!initialRunId) {
      setMaxStepIndex(0);
      return;
    }
    setMaxStepIndex(0);
    setLoadingLabel(pickRandomLoadingLabel());
  }, [initialRunId]);

  useEffect(() => {
    if (!initialRunId) return;
    setMaxStepIndex((prev) => Math.max(prev, stageStepIndex));
  }, [initialRunId, stageStepIndex]);

  const activeMajorStep = Math.max(maxStepIndex, stageStepIndex);
  const isBuildingView = isInitialStreaming && activeMajorStep >= MAJOR_REVIEW_STEPS.length - 1;

  useEffect(() => {
    if (!initialRunId || isBuildingView) return;
    const timer = window.setInterval(() => {
      setLoadingLabel((prev) => pickRandomLoadingLabel(prev));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [initialRunId, isBuildingView]);

  const visibleSteps = isInitialStreaming ? MAJOR_REVIEW_STEPS.slice(0, activeMajorStep + 1) : [];
  const activeLoadingText = isBuildingView ? FINAL_LOADING_STEP : loadingLabel;

  useEffect(() => {
    const el = thinkingRef.current;
    if (el && visibleSteps.length > 0) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleSteps.length]);
  const activeReviewIdRef = useRef(activeReviewId);
  activeReviewIdRef.current = activeReviewId;
  const quotedSelectionRef = useRef(quotedSelection);
  quotedSelectionRef.current = quotedSelection;

  useEffect(() => {
    const stream = streamRef.current;
    if (prevReviewIdRef.current !== activeReviewId) {
      const isInitialMount = prevReviewIdRef.current === undefined;
      prevReviewIdRef.current = activeReviewId;
      prevMessageCountRef.current = chatMessages.length;
      if (!isInitialMount) {
        setQuotedSelection(null);
      }
      if (stream) {
        stream.scrollTop = activeStreamingChat !== null ? stream.scrollHeight : 0;
      }
      return;
    }

    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = chatMessages.length;
    if (!stream) return;

    const messageAdded = prevCount !== null && chatMessages.length > prevCount;
    if (messageAdded) {
      stream.scrollTop = stream.scrollHeight;
    } else if (activeStreamingChat !== null) {
      const distanceFromBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
      if (distanceFromBottom < 80) {
        stream.scrollTop = stream.scrollHeight;
      }
    }
  }, [activeReviewId, chatMessages.length, activeStreamingChat, setQuotedSelection]);

  const handleAskSelection = useCallback(
    (selection: { text: string; heading?: string }) => {
      setQuotedSelection(selection);
      composerInputRef.current?.focus();
    },
    [setQuotedSelection],
  );

  const handleSend = useCallback(
    async (trimmedPrompt: string): Promise<boolean> => {
      if (composerDisabled) return false;
      const capturedReviewId = activeReviewIdRef.current;
      const currentQuote = quotedSelection;
      const ok = await aiSendFollowup({
        prompt: trimmedPrompt,
        quotedText: currentQuote?.text,
        sectionHeading: currentQuote?.heading,
      });
      if (
        ok &&
        activeReviewIdRef.current === capturedReviewId &&
        quotedSelectionRef.current === currentQuote
      ) {
        setQuotedSelection(null);
      }
      return ok;
    },
    [composerDisabled, quotedSelection, aiSendFollowup, setQuotedSelection],
  );

  const handleClearQuote = useCallback(() => {
    setQuotedSelection(null);
  }, [setQuotedSelection]);

  const handleClearThread = useCallback(() => {
    void aiClearThread();
  }, [aiClearThread]);

  const handleCancelFollowup = useCallback(() => {
    if (activeRun && isFollowupRunId(activeRun.runId)) {
      cancelTask(activeRun.runId);
    }
  }, [activeRun, cancelTask]);

  if (!repo) return null;

  const targetIsBranch = repo.target !== null && repo.target === repo.branch;
  const hasTarget = Boolean(repo.target && !targetIsBranch);
  const parsedBalance = account ? Number.parseFloat(account.balanceUsd) : 0;
  const hasBalance = Boolean(account && Number.isFinite(parsedBalance) && parsedBalance > 0);

  const availableModels = modelsCatalog?.models ?? [];
  const hasModels = availableModels.length > 0;
  const currentModelId =
    selectedModel ??
    (modelsCatalog?.defaultModel &&
    availableModels.some(
      (m) => m.id === modelsCatalog.defaultModel || m.name === modelsCatalog.defaultModel,
    )
      ? modelsCatalog.defaultModel
      : (availableModels[0]?.id ?? null));
  const currentModelName =
    availableModels.find((m) => m.id === currentModelId || m.name === currentModelId)?.name ??
    currentModelId ??
    (hasModels ? "Select model" : "No models available");

  const availableEfforts = modelsCatalog?.efforts ?? [];
  const hasEfforts = availableEfforts.length > 0;
  const currentEffortId =
    selectedEffort ??
    (modelsCatalog?.defaultEffort &&
    availableEfforts.some(
      (e) => e.id === modelsCatalog.defaultEffort || e.name === modelsCatalog.defaultEffort,
    )
      ? modelsCatalog.defaultEffort
      : (availableEfforts[0]?.id ?? null));
  const currentEffortName =
    availableEfforts.find((e) => e.id === currentEffortId || e.name === currentEffortId)?.name ??
    (currentEffortId ? currentEffortId.charAt(0).toUpperCase() + currentEffortId.slice(1) : null);

  const activeReview = reviews.find((r) => r.id === activeReviewId);
  const versions = activeReview?.versions ?? [];
  const activeVersion =
    selectedVersionNumber !== null
      ? versions.find((v) => v.versionNumber === selectedVersionNumber)
      : versions.length > 0
        ? versions[versions.length - 1]
        : null;
  const displayedMarkdown = activeVersion?.reportMarkdown ?? reportMarkdown;
  const currentDisplayVersionNumber = activeVersion?.versionNumber ?? 1;
  const latestVersion = versions.length > 0 ? versions[versions.length - 1] : undefined;
  const isViewingPreviousVersion =
    versions.length > 1 &&
    activeVersion != null &&
    latestVersion != null &&
    activeVersion.versionNumber !== latestVersion.versionNumber;
  const currentVersionIndex = versions.findIndex(
    (v) => v.versionNumber === currentDisplayVersionNumber,
  );
  const prevVersion = currentVersionIndex > 0 ? versions[currentVersionIndex - 1] : undefined;
  const nextVersion =
    currentVersionIndex >= 0 && currentVersionIndex < versions.length - 1
      ? versions[currentVersionIndex + 1]
      : undefined;

  const displayReviews: DisplayReviewItem[] = [
    ...(isInitialStreaming
      ? [
          {
            id: PENDING_REVIEW_ID,
            reviewNumber: reviews.length + 1,
            branch: repo.branch ?? "",
            targetBranch: repo.target ?? "",
            costUsd: null,
            createdAt: Math.floor(Date.now() / 1000),
            isPending: true,
          },
        ]
      : []),
    ...reviews.map((rev, index) => ({
      id: rev.id,
      reviewNumber: reviews.length - index,
      branch: rev.branch,
      targetBranch: rev.targetBranch,
      costUsd: rev.costUsd ?? null,
      createdAt: rev.createdAt,
    })),
  ];

  const activeDisplayReview =
    displayReviews.find((r) => r.id === activeReviewId) ?? displayReviews[0];
  const currentReviewLabel = activeDisplayReview
    ? `Review #${activeDisplayReview.reviewNumber}`
    : "No reviews";

  const renderVersionBar = () => {
    if (versions.length <= 1) return null;
    return (
      <div className="dl-ai-version-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600 }}>
            Version {currentDisplayVersionNumber} of {versions.length}
          </span>
          {isViewingPreviousVersion && <span className="dl-chip">Earlier version</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            className="dl-btn dl-btn-sm"
            type="button"
            disabled={!prevVersion}
            onClick={() => prevVersion && selectVersion(prevVersion.versionNumber)}
            title="Previous version"
          >
            <Icon name="general-chevronLeft" />
            Prev
          </button>
          <button
            className="dl-btn dl-btn-sm"
            type="button"
            disabled={!nextVersion}
            onClick={() => nextVersion && selectVersion(nextVersion.versionNumber)}
            title="Next version"
          >
            Next
            <Icon name="general-chevronRight" />
          </button>
          {isViewingPreviousVersion && activeReviewId && (
            <button
              className="dl-btn dl-btn-sm dl-btn-primary"
              type="button"
              onClick={() => void aiRevertVersion(activeReviewId, currentDisplayVersionNumber)}
            >
              Revert to this version
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <section
          className="dl-island app-ai-review"
          style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}
          aria-label="AI review"
        >
          <header className="dl-island-header">
            <span className="dl-island-title">AI review</span>
            <span className="dl-toolbar-spacer" />

            {account && (
              <button
                className="dl-ai-pill dl-ai-pill-btn"
                type="button"
                onClick={() => void aiAddFunds(10)}
                title="Add funds"
              >
                <Icon name="diff-magicResolveToolbar" />
                <span>Balance {formatBalanceUsd(account.balanceUsd)}</span>
              </button>
            )}

            {reportMarkdown && reviewCostUsd && (
              <span className="dl-ai-pill dl-ai-pill-muted">
                <span>Cost {formatReviewCostUsd(reviewCostUsd)}</span>
              </span>
            )}

            {account && (
              <button
                className="dl-btn dl-btn-sm"
                type="button"
                onClick={() => void aiAddFunds(10)}
              >
                Add funds
              </button>
            )}

            {isViewingPendingReview ? (
              <>
                <button className="dl-btn dl-btn-sm" type="button" disabled>
                  <Icon name="general-refresh" />
                  Re-run review
                </button>
                <button className="dl-btn dl-btn-sm" type="button" onClick={cancelAiReview}>
                  <Icon name="general-close" />
                  Cancel review
                </button>
              </>
            ) : displayedMarkdown ? (
              <>
                <button
                  className="dl-btn dl-btn-sm"
                  type="button"
                  disabled={
                    !hasBalance ||
                    !hasTarget ||
                    !hasModels ||
                    isInitialStreaming ||
                    isFollowupStreaming
                  }
                  onClick={() => setConfirmRerun(true)}
                >
                  <Icon name="general-refresh" />
                  Re-run review
                </button>
                <button
                  className="dl-btn dl-btn-sm"
                  type="button"
                  disabled={
                    !hasBalance ||
                    !hasTarget ||
                    !hasModels ||
                    isInitialStreaming ||
                    isFollowupStreaming
                  }
                  onClick={() => void startAiReview()}
                >
                  <Icon name="general-add" />
                  New review
                </button>
              </>
            ) : (
              <button
                className="dl-btn dl-btn-sm dl-btn-primary"
                type="button"
                disabled={!consentAccepted || !account || !hasBalance || !hasTarget || !hasModels}
                onClick={() => void startAiReview()}
              >
                Run review
              </button>
            )}

            {account ? (
              <button className="dl-btn dl-btn-sm" type="button" onClick={() => void aiSignOut()}>
                Sign out
              </button>
            ) : consentAccepted ? (
              <button
                className="dl-btn dl-btn-primary dl-btn-sm"
                type="button"
                onClick={() => void aiSignIn()}
              >
                Sign in
              </button>
            ) : null}
          </header>

          <div className="dl-ai-subheader">
            {displayReviews.length > 0 && (
              <>
                <button
                  ref={reviewAnchor}
                  className={`dl-combo ${pickingReview ? "is-focused" : ""}`}
                  type="button"
                  title="Review history"
                  onClick={() => {
                    setPickingReview(!pickingReview);
                    setPickingModel(false);
                    setPickingEffort(false);
                    setPickingTarget(false);
                  }}
                >
                  <Icon name="general-history" />
                  <span className="dl-combo-label">review:</span>
                  <span className="dl-combo-text">{currentReviewLabel}</span>
                  {isCurrentReviewBusy && (
                    <span className="dl-ai-pulse-dot" aria-hidden="true" title="In progress" />
                  )}
                  <Icon name="general-chevronDown" />
                </button>
                {pickingReview && (
                  <ReviewPicker
                    anchor={reviewAnchor}
                    reviews={displayReviews}
                    activeId={activeDisplayReview?.id ?? activeReviewId}
                    runningReviewId={runningReviewId}
                    canStartNew={
                      Boolean(consentAccepted && account && hasBalance && hasTarget && hasModels) &&
                      !isInitialStreaming &&
                      !isFollowupStreaming
                    }
                    onSelect={(id) => void switchReview(id)}
                    onNew={() => void startAiReview()}
                    onClose={() => setPickingReview(false)}
                  />
                )}
              </>
            )}
            <span className="dl-combo" style={{ cursor: "default" }}>
              <span className="dl-combo-label">branch:</span>
              <span className="dl-combo-text">{repo.branch}</span>
              <Icon name="general-chevronDown" />
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>vs</span>
            <button
              ref={targetAnchor}
              className={`dl-combo ${targetIsBranch ? "is-error" : ""}`}
              type="button"
              title={
                repo.target
                  ? `${repo.target}${repo.target === repo.defaultBranch ? " (default branch)" : ""}`
                  : "Pick target branch"
              }
              onClick={() => setPickingTarget(!pickingTarget)}
            >
              <span className="dl-combo-label">target:</span>
              <span className="dl-combo-text">{repo.target ?? "pick target"}</span>
              <Icon name="general-chevronDown" />
            </button>
            {pickingTarget && (
              <TargetPicker anchor={targetAnchor} onClose={() => setPickingTarget(false)} />
            )}

            {hasModels ? (
              <>
                <button
                  ref={modelAnchor}
                  className={`dl-combo ${pickingModel ? "is-focused" : ""}`}
                  type="button"
                  title="Model"
                  onClick={() => {
                    setPickingModel(!pickingModel);
                    setPickingEffort(false);
                    setPickingTarget(false);
                  }}
                >
                  <span className="dl-combo-label">model:</span>
                  <span className="dl-combo-text">{currentModelName}</span>
                  <Icon name="general-chevronDown" />
                </button>
                {pickingModel && (
                  <ModelPicker
                    anchor={modelAnchor}
                    catalog={modelsCatalog}
                    selected={currentModelId}
                    onSelect={(m) => setSelectedModel(m)}
                    onClose={() => setPickingModel(false)}
                  />
                )}
              </>
            ) : (
              <span
                className="dl-combo"
                title="No models currently available from the ACP agent"
                style={{ opacity: 0.7, cursor: "default" }}
              >
                <span className="dl-combo-label">model:</span>
                <span className="dl-combo-text">No models available</span>
              </span>
            )}

            {hasEfforts && (
              <>
                <button
                  ref={effortAnchor}
                  className={`dl-combo ${pickingEffort ? "is-focused" : ""}`}
                  type="button"
                  title="Reasoning effort"
                  onClick={() => {
                    setPickingEffort(!pickingEffort);
                    setPickingModel(false);
                    setPickingTarget(false);
                  }}
                >
                  <span className="dl-combo-label">effort:</span>
                  <span className="dl-combo-text">{currentEffortName}</span>
                  <Icon name="general-chevronDown" />
                </button>
                {pickingEffort && (
                  <EffortPicker
                    anchor={effortAnchor}
                    catalog={modelsCatalog}
                    selected={currentEffortId}
                    onSelect={(e) => setSelectedEffort(e)}
                    onClose={() => setPickingEffort(false)}
                  />
                )}
              </>
            )}
          </div>

          {inlineError && (
            <div className="dl-banner is-error" style={{ margin: "8px 16px" }}>
              <span>{inlineError}</span>
            </div>
          )}

          {!consentAccepted ? (
            <div className="dl-island-body dl-ai-state" style={{ flex: 1, overflowY: "auto" }}>
              <div className="dl-ai-card">
                <Icon
                  name="diff-magicResolveToolbar"
                  style={{ width: 24, height: 24, backgroundSize: "24px 24px" }}
                />
                <h2 className="dl-ai-state-title">AI code review disclosure</h2>
                <div
                  className="dl-ai-state-desc"
                  style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>
                      What data is used
                    </div>
                    <div>
                      Diffloupe sends your repository snapshot and branch diff to the review server
                      for analysis.
                    </div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>
                      Do we delete everything
                    </div>
                    <div>
                      The server deletes the repository copy and the generated report immediately
                      once analysis finishes.
                    </div>
                  </div>
                </div>
                <div className="dl-ai-state-actions">
                  <button
                    className="dl-btn dl-btn-primary"
                    type="button"
                    aria-label="Allow AI review"
                    onClick={() => void setAiConsent(true)}
                  >
                    Allow AI review
                  </button>
                  <button
                    className="dl-btn"
                    type="button"
                    onClick={() => setWorkspaceMode("manual")}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : !account ? (
            <div className="dl-island-body dl-ai-state" style={{ flex: 1, overflowY: "auto" }}>
              <div className="dl-ai-card">
                <Icon
                  name="diff-magicResolveToolbar"
                  style={{ width: 24, height: 24, backgroundSize: "24px 24px" }}
                />
                <h2 className="dl-ai-state-title">Sign in to Diffloupe</h2>
                <p className="dl-ai-state-desc">
                  Sign in with your browser to check your review balance and run AI reviews.
                  Diffloupe never asks for model API keys.
                </p>
                {authPending ? (
                  <>
                    <div style={{ marginTop: 8 }}>
                      Verification code: <strong>{authPending.userCode}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                      A browser tab opened at {authPending.verificationUrl}. Waiting for
                      authorization…
                    </div>
                    <div className="dl-ai-state-actions">
                      <button className="dl-btn dl-btn-sm" type="button" onClick={cancelAiSignIn}>
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="dl-ai-state-actions">
                      <button
                        className="dl-btn dl-btn-primary"
                        type="button"
                        onClick={() => void aiSignIn()}
                      >
                        Sign in with browser
                      </button>
                      <button
                        className="dl-btn"
                        type="button"
                        onClick={() => setWorkspaceMode("manual")}
                      >
                        Cancel
                      </button>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                      A browser tab will open at cloud.diffloupe.com.
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : !hasTarget ? (
            <div className="dl-island-body dl-ai-state" style={{ flex: 1, overflowY: "auto" }}>
              <div className="dl-ai-card">
                <Icon
                  name="diff-magicResolveToolbar"
                  style={{ width: 24, height: 24, backgroundSize: "24px 24px" }}
                />
                <h2 className="dl-ai-state-title">Choose a target branch</h2>
                <p className="dl-ai-state-desc">
                  AI review compares your working branch against a target branch to analyze changes.
                </p>
                <div className="dl-ai-state-actions">
                  <button
                    ref={targetAnchor}
                    className="dl-btn dl-btn-primary"
                    type="button"
                    onClick={() => setPickingTarget(true)}
                  >
                    Select target branch
                  </button>
                </div>
              </div>
            </div>
          ) : !hasBalance ? (
            <div className="dl-island-body dl-ai-state" style={{ flex: 1, overflowY: "auto" }}>
              <div className="dl-ai-card">
                <Icon
                  name="diff-magicResolveToolbar"
                  style={{ width: 24, height: 24, backgroundSize: "24px 24px" }}
                />
                <h2 className="dl-ai-state-title">Add review balance</h2>
                <p className="dl-ai-state-desc">
                  Your balance is {formatBalanceUsd(account.balanceUsd)}. Add funds to run
                  whole-repository AI reviews and interactive chat turns. Model usage is included.
                </p>
                <div className="dl-ai-packs">
                  <button className="dl-ai-pack" type="button" onClick={() => void aiAddFunds(10)}>
                    <strong>$10</strong>
                    <span>Starter</span>
                  </button>
                  <button className="dl-ai-pack" type="button" onClick={() => void aiAddFunds(25)}>
                    <strong>$25</strong>
                    <span>Standard</span>
                  </button>
                  <button className="dl-ai-pack" type="button" onClick={() => void aiAddFunds(50)}>
                    <strong>$50</strong>
                    <span>Pro</span>
                  </button>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  Opens Stripe Checkout in your browser. Prepaid money balance only.
                </div>
              </div>
            </div>
          ) : activeRun || displayedMarkdown ? (
            <section
              className="dl-island-body dl-ai-session"
              aria-label="Interactive chat"
              style={{ padding: 0 }}
            >
              <div className="dl-ai-session-stream" ref={streamRef}>
                {isViewingPendingReview && activeRun && (
                  <div
                    style={{
                      maxWidth: 920,
                      width: "100%",
                      margin: "0 auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                      padding: "16px 20px",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-6)",
                      background: "var(--panel-bg-inline)",
                      boxSizing: "border-box",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span
                          className="dl-ai-pulse-dot"
                          style={{ width: 10, height: 10 }}
                          aria-hidden="true"
                        />
                        <span style={{ fontWeight: 600, fontSize: 14 }}>Review in progress</span>
                      </div>
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        Comparing {repo.branch} against {repo.target}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <span style={{ fontWeight: 500, color: "var(--text)" }}>
                        {activeLoadingText}
                      </span>
                    </div>

                    {visibleSteps.length > 0 && (
                      <div
                        ref={thinkingRef}
                        style={{
                          marginTop: 4,
                          padding: "10px 12px",
                          background: "var(--window-bg)",
                          borderRadius: "var(--radius-4)",
                          border: "1px solid var(--border)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          maxHeight: 180,
                          overflowY: "auto",
                          fontSize: 12,
                          fontFamily: "var(--font-code, monospace)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--text-muted)",
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                            marginBottom: 2,
                          }}
                        >
                          Review progress
                        </div>
                        {visibleSteps.map((step, idx) => {
                          const isLatest = idx === visibleSteps.length - 1;
                          return (
                            <div
                              key={step}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                color: isLatest ? "var(--text)" : "var(--text-muted)",
                                lineHeight: 1.4,
                              }}
                            >
                              {isLatest ? (
                                <span className="dl-ai-pulse-dot" aria-hidden="true" />
                              ) : (
                                <span
                                  style={{
                                    color: "var(--success, #59a869)",
                                    fontWeight: 700,
                                    flexShrink: 0,
                                  }}
                                >
                                  ✓
                                </span>
                              )}
                              <span>{step}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {(displayedMarkdown || isViewingPendingReview) && (
                  <>
                    {renderVersionBar()}
                    <ReportViewer
                      markdown={displayedMarkdown ?? ""}
                      onAskSelection={handleAskSelection}
                      isStreamingInitial={isViewingPendingReview}
                      reviewIdentity={activeReviewId}
                    />
                  </>
                )}

                {!isViewingPendingReview && (
                  <AiChatThread
                    chatMessages={chatMessages}
                    streamingChat={activeStreamingChat}
                    isFollowupStreaming={isViewingFollowupRun}
                  />
                )}
              </div>

              {(displayedMarkdown || isViewingPendingReview) && (
                <AiChatComposer
                  reviewIdentity={activeReviewId}
                  quotedSelection={quotedSelection}
                  onClearQuote={handleClearQuote}
                  onSend={handleSend}
                  onClearThread={handleClearThread}
                  onCancelFollowup={handleCancelFollowup}
                  hasMessages={chatMessages.length > 0}
                  isFollowupStreaming={isViewingFollowupRun}
                  disabled={composerDisabled}
                  inputRef={composerInputRef}
                />
              )}
            </section>
          ) : (
            <div className="dl-island-body dl-ai-state" style={{ flex: 1, overflowY: "auto" }}>
              <div className="dl-ai-card">
                <Icon
                  name="diff-magicResolveToolbar"
                  style={{ width: 24, height: 24, backgroundSize: "24px 24px" }}
                />
                <h2 className="dl-ai-state-title">
                  {hasModels ? "Ready for AI review" : "No models available"}
                </h2>
                <p className="dl-ai-state-desc">
                  {hasModels
                    ? `Compare ${repo.branch} against ${repo.target} to analyze changes and generate findings.`
                    : "There are currently no AI models available from the ACP agent. Ensure an ACP agent or language model server is running and configured."}
                </p>
                {hasModels && (
                  <div className="dl-ai-state-actions">
                    <button
                      className="dl-btn dl-btn-primary"
                      type="button"
                      onClick={() => void startAiReview()}
                    >
                      Run review
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
      {confirmRerun && (
        <Dialog label="Re-run review" onClose={() => setConfirmRerun(false)}>
          <div className="dl-dialog-title">Re-run review?</div>
          <p className="dl-dialog-text">
            This will permanently delete this review report and its chat history, and start a fresh
            new review.
          </p>
          <div className="dl-dialog-footer">
            <button className="dl-btn" type="button" onClick={() => setConfirmRerun(false)}>
              Cancel
            </button>
            <button
              className="dl-btn dl-btn-primary"
              type="button"
              onClick={async () => {
                setConfirmRerun(false);
                if (activeReviewId) {
                  await aiDeleteReview(activeReviewId);
                }
                await startAiReview();
              }}
            >
              Re-run Review
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
