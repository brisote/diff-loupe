import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { StoredAiReview } from "../api/generated/StoredAiReview";
import { Dialog } from "../lib/dialog";
import { Icon } from "../lib/icon";
import { Popup, useBelow } from "../lib/popup";
import { clampWidth, Splitter } from "../main-window/Splitter";
import { TargetPicker } from "../main-window/TargetPicker";
import { useApp } from "../state/context";
import { AiChatPanel } from "./AiChatPanel";
import { EffortPicker, ModelPicker } from "./ModelPicker";
import { formatBalanceUsd, formatReviewCostUsd } from "./money";
import { ReportViewer } from "./ReportViewer";

export const aiChatHeightKey = "aiChatHeight";
export const defaultAiChat = 240;
export const minAiChat = 140;

type ReviewPickerProps = {
  anchor: RefObject<HTMLElement | null>;
  reviews: StoredAiReview[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  onClose: () => void;
};

function ReviewPicker({ anchor, reviews, activeId, onSelect, onNew, onClose }: ReviewPickerProps) {
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
          onClick={() => {
            onClose();
            onNew();
          }}
        >
          <Icon name="general-add" />
          New review
        </button>
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {reviews.map((rev, index) => {
          const isSelected = rev.id === activeId;
          const reviewNumber = reviews.length - index;
          const cost = rev.costUsd ? formatReviewCostUsd(rev.costUsd) : "$0.00";
          const dateStr = new Date(rev.createdAt * 1000).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });

          return (
            <button
              key={rev.id}
              type="button"
              className={`dl-row ${isSelected ? "is-selected" : ""}`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                padding: "8px 10px",
                gap: 2,
                textAlign: "left",
                width: "100%",
                borderBottom: "1px solid var(--border-subtle, var(--border))",
              }}
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
                <span style={{ fontWeight: 600 }}>Review #{reviewNumber}</span>
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
                <span>Cost {cost}</span>
              </div>
            </button>
          );
        })}
      </div>
    </Popup>
  );
}

export function AiReviewIsland() {
  const backend = useApp((state) => state.backend);
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
  const isChatOpen = useApp((state) => state.isChatOpen);
  const toggleAiChat = useApp((state) => state.toggleAiChat);
  const setAiChatOpen = useApp((state) => state.setAiChatOpen);
  const setQuotedSelection = useApp((state) => state.setQuotedSelection);
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
  const [pickingReview, setPickingReview] = useState(false);
  const [pickingTarget, setPickingTarget] = useState(false);
  const [pickingModel, setPickingModel] = useState(false);
  const [pickingEffort, setPickingEffort] = useState(false);
  const [confirmRerun, setConfirmRerun] = useState(false);
  const [chatHeight, setChatHeight] = useState(defaultAiChat);
  const [maxChatHeight, setMaxChatHeight] = useState(600);

  useEffect(() => {
    void backend
      .call("get_ui_value", { key: aiChatHeightKey })
      .then((saved) => {
        const value = Number(saved);
        if (saved && Number.isFinite(value)) setChatHeight(value);
      })
      .catch(() => undefined);
  }, [backend]);

  useEffect(() => {
    const updateMax = () => {
      setMaxChatHeight(Math.round(window.innerHeight * 0.7));
    };
    updateMax();
    window.addEventListener("resize", updateMax);
    return () => window.removeEventListener("resize", updateMax);
  }, []);

  const saveChatHeight = (value: number) => {
    void backend
      .call("set_ui_value", { key: aiChatHeightKey, value: String(value) })
      .catch(() => undefined);
  };

  const handleAskSelection = (selection: { text: string; heading?: string }) => {
    setQuotedSelection(selection);
    setAiChatOpen(true);
  };

  if (!repo) return null;

  const targetIsBranch = repo.target !== null && repo.target === repo.branch;
  const hasTarget = Boolean(repo.target && !targetIsBranch);
  const parsedBalance = account ? Number.parseFloat(account.balanceUsd) : 0;
  const hasBalance = Boolean(account && Number.isFinite(parsedBalance) && parsedBalance > 0);
  const height = clampWidth(chatHeight, minAiChat, maxChatHeight);

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

  const activeIndex = reviews.findIndex((r) => r.id === activeReviewId);
  const currentReviewLabel =
    activeIndex >= 0
      ? `Review #${reviews.length - activeIndex}`
      : reviews.length > 0
        ? `Review #${reviews.length}`
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
            {reviews.length > 0 && (
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
                  <Icon name="general-chevronDown" />
                </button>
                {pickingReview && (
                  <ReviewPicker
                    anchor={reviewAnchor}
                    reviews={reviews}
                    activeId={activeReviewId}
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

            {activeRun ? (
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
                  disabled={!hasBalance || !hasTarget || !hasModels}
                  onClick={() => setConfirmRerun(true)}
                >
                  <Icon name="general-refresh" />
                  Re-run review
                </button>
                <button
                  className="dl-btn dl-btn-sm"
                  type="button"
                  disabled={!hasBalance || !hasTarget || !hasModels}
                  onClick={() => void startAiReview()}
                >
                  <Icon name="general-add" />
                  New review
                </button>
                <button
                  className={`dl-tbtn ${isChatOpen ? "is-toggled" : ""}`}
                  type="button"
                  title="Chat"
                  aria-label="Chat"
                  aria-pressed={isChatOpen}
                  onClick={toggleAiChat}
                >
                  <Icon name="toolwindows-terminal" />
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
          ) : activeRun ? (
            <div
              className="dl-island-body"
              style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}
            >
              <div
                style={{
                  maxWidth: 820,
                  margin: "0 auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 20,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    padding: "16px 20px",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-6)",
                    background: "var(--panel-bg-inline)",
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
                        className="dl-caret"
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: "var(--accent)",
                        }}
                      />
                      <span style={{ fontWeight: 600, fontSize: 14 }}>Review in progress</span>
                    </div>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Comparing {repo.branch} against {repo.target}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span style={{ fontWeight: 500, color: "var(--text)" }}>
                      {activeRun.message || activeRun.stage || "Analyzing branch changes…"}
                    </span>
                  </div>

                  {activeRun.thoughts &&
                    activeRun.thoughts.length > 0 &&
                    (() => {
                      const thoughts = activeRun.thoughts;
                      return (
                        <div
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
                            Model Thinking
                          </div>
                          {thoughts.map((thought, idx) => {
                            const isLatest = idx === thoughts.length - 1;
                            return (
                              <div
                                key={thought}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  color: isLatest ? "var(--text)" : "var(--text-muted)",
                                  lineHeight: 1.4,
                                }}
                              >
                                <span
                                  style={{
                                    color: isLatest ? "var(--accent)" : "var(--success, #59a869)",
                                    fontWeight: 700,
                                    flexShrink: 0,
                                  }}
                                >
                                  {isLatest ? "●" : "✓"}
                                </span>
                                <span>{thought}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                </div>
                {displayedMarkdown ? (
                  <div style={{ padding: 0 }}>
                    {renderVersionBar()}
                    <ReportViewer
                      markdown={displayedMarkdown}
                      onAskSelection={handleAskSelection}
                    />
                    <span className="dl-caret" />
                  </div>
                ) : null}
              </div>
            </div>
          ) : displayedMarkdown ? (
            <div
              className="dl-island-body"
              style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}
            >
              {renderVersionBar()}
              <ReportViewer markdown={displayedMarkdown} onAskSelection={handleAskSelection} />
            </div>
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
      {isChatOpen && (
        <>
          <Splitter
            vertical
            label="Resize AI chat"
            width={height}
            min={minAiChat}
            max={maxChatHeight}
            onResize={setChatHeight}
            onResizeEnd={saveChatHeight}
          />
          <AiChatPanel height={height} onClose={() => setAiChatOpen(false)} />
        </>
      )}
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
