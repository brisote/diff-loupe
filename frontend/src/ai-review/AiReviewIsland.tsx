import { useEffect, useRef, useState } from "react";
import { Icon } from "../lib/icon";
import { clampWidth, Splitter } from "../main-window/Splitter";
import { TargetPicker } from "../main-window/TargetPicker";
import { useApp } from "../state/context";
import { AiChatPanel } from "./AiChatPanel";
import { formatBalanceUsd, formatReviewCostUsd } from "./money";
import { ReportViewer } from "./ReportViewer";

export const aiChatHeightKey = "aiChatHeight";
export const defaultAiChat = 240;
export const minAiChat = 140;

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

  const targetAnchor = useRef<HTMLButtonElement>(null);
  const [pickingTarget, setPickingTarget] = useState(false);
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
            ) : reportMarkdown ? (
              <>
                <button
                  className="dl-btn dl-btn-sm"
                  type="button"
                  disabled={!hasBalance || !hasTarget}
                  onClick={() => void startAiReview()}
                >
                  <Icon name="general-refresh" />
                  Re-run review
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
                disabled={!consentAccepted || !account || !hasBalance || !hasTarget}
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
                    gap: 10,
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
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Review in progress</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Comparing {repo.branch} against {repo.target}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <span
                        className="dl-caret"
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "var(--accent)",
                          margin: "0 4px",
                        }}
                      />
                      <span style={{ fontWeight: 600, color: "var(--text)" }}>
                        {activeRun.message || activeRun.stage || "Analyzing branch changes…"}
                      </span>
                    </div>
                  </div>
                </div>
                {reportMarkdown ? (
                  <div style={{ padding: 0 }}>
                    <ReportViewer markdown={reportMarkdown} onAskSelection={handleAskSelection} />
                    <span className="dl-caret" />
                  </div>
                ) : null}
              </div>
            </div>
          ) : reportMarkdown ? (
            <div
              className="dl-island-body"
              style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}
            >
              <ReportViewer markdown={reportMarkdown} onAskSelection={handleAskSelection} />
            </div>
          ) : (
            <div className="dl-island-body dl-ai-state" style={{ flex: 1, overflowY: "auto" }}>
              <div className="dl-ai-card">
                <Icon
                  name="diff-magicResolveToolbar"
                  style={{ width: 24, height: 24, backgroundSize: "24px 24px" }}
                />
                <h2 className="dl-ai-state-title">Ready for AI review</h2>
                <p className="dl-ai-state-desc">
                  Compare {repo.branch} against {repo.target} to analyze changes and generate
                  findings.
                </p>
                <div className="dl-ai-state-actions">
                  <button
                    className="dl-btn dl-btn-primary"
                    type="button"
                    onClick={() => void startAiReview()}
                  >
                    Run review
                  </button>
                </div>
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
    </div>
  );
}
