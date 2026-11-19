import type { KeyboardEvent, RefObject } from "react";
import { memo, useEffect, useRef, useState } from "react";
import { Icon } from "../lib/icon";

type AiChatComposerProps = {
  reviewIdentity: number | null;
  quotedSelection: { text: string; heading?: string } | null;
  onClearQuote: () => void;
  onSend: (prompt: string) => Promise<boolean>;
  onClearThread: () => void;
  onCancelFollowup: () => void;
  hasMessages: boolean;
  isFollowupStreaming: boolean;
  disabled: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
};

export const AiChatComposer = memo(function AiChatComposer({
  reviewIdentity,
  quotedSelection,
  onClearQuote,
  onSend,
  onClearThread,
  onCancelFollowup,
  hasMessages,
  isFollowupStreaming,
  disabled,
  inputRef,
}: AiChatComposerProps) {
  const [prompt, setPrompt] = useState("");
  const prevReviewIdRef = useRef<number | null | undefined>(undefined);
  const reviewIdentityRef = useRef(reviewIdentity);
  reviewIdentityRef.current = reviewIdentity;
  const sendingRef = useRef(false);
  const localInputRef = useRef<HTMLTextAreaElement>(null);
  const resolvedInputRef = inputRef ?? localInputRef;

  useEffect(() => {
    if (prevReviewIdRef.current !== reviewIdentity) {
      const isInitialMount = prevReviewIdRef.current === undefined;
      prevReviewIdRef.current = reviewIdentity;
      if (!isInitialMount) {
        setPrompt("");
      }
    }
  }, [reviewIdentity]);

  useEffect(() => {
    if (quotedSelection) {
      resolvedInputRef.current?.focus();
    }
  }, [quotedSelection, resolvedInputRef]);

  const handleSend = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || disabled || sendingRef.current) return;
    const capturedReviewId = reviewIdentityRef.current;
    sendingRef.current = true;
    try {
      const sent = await onSend(trimmed);
      if (sent && reviewIdentityRef.current === capturedReviewId) {
        setPrompt("");
      }
    } finally {
      sendingRef.current = false;
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="dl-ai-composer">
      {quotedSelection && (
        <div className="dl-ai-quote-chip" style={{ alignSelf: "flex-start", marginBottom: 4 }}>
          <Icon name="diff-magicResolveToolbar" />
          <span className="dl-ai-quote-text">{quotedSelection.text}</span>
          <button
            className="dl-tbtn"
            type="button"
            style={{ width: 16, height: 16, padding: 0 }}
            title="Dismiss quote"
            aria-label="Dismiss quote"
            onClick={onClearQuote}
          >
            <Icon name="general-close" />
          </button>
        </div>
      )}
      <div className="dl-ai-composer-row">
        <textarea
          ref={resolvedInputRef}
          className="dl-ai-composer-input dl-textarea"
          rows={1}
          placeholder="Ask about this review or request changes…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        {hasMessages && (
          <button
            className="dl-btn dl-btn-sm"
            type="button"
            title="Clear thread"
            aria-label="Clear thread"
            disabled={disabled}
            onClick={onClearThread}
          >
            Clear thread
          </button>
        )}
        <button
          className="dl-btn dl-btn-primary dl-btn-sm"
          type="button"
          disabled={disabled || !prompt.trim()}
          onClick={() => void handleSend()}
        >
          Send
        </button>
      </div>
      {isFollowupStreaming && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--text-muted)",
            marginTop: 2,
          }}
        >
          <span>Analyzing follow-up question…</span>
          <button className="dl-btn dl-btn-sm" type="button" onClick={onCancelFollowup}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
});
