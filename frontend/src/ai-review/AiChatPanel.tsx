import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Icon } from "../lib/icon";
import { MarkdownDocument } from "../markdown-diff/MarkdownDocument";
import { useApp } from "../state/context";
import { formatReviewCostUsd } from "./money";

function cleanChatContent(content: string): string {
  if (content.includes("--- REPORT UPDATE ---")) {
    const parts = content.split("--- REPORT UPDATE ---");
    return (parts[0] ?? "").trim();
  }
  return content;
}

type AiChatPanelProps = {
  height: number;
  onClose: () => void;
};

export function AiChatPanel({ height, onClose }: AiChatPanelProps) {
  const chatMessages = useApp((state) => state.chatMessages);
  const streamingChat = useApp((state) => state.streamingChat);
  const quotedSelection = useApp((state) => state.quotedSelection);
  const setQuotedSelection = useApp((state) => state.setQuotedSelection);
  const aiSendFollowup = useApp((state) => state.aiSendFollowup);
  const aiClearThread = useApp((state) => state.aiClearThread);
  const cancelTask = useApp((state) => state.cancelTask);

  const [prompt, setPrompt] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isSending = streamingChat !== null;

  useEffect(() => {
    if (quotedSelection) {
      inputRef.current?.focus();
    }
  }, [quotedSelection]);

  useEffect(() => {
    void chatMessages;
    void streamingChat;
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [chatMessages, streamingChat]);

  const handleSend = () => {
    const trimmed = prompt.trim();
    if (!trimmed || isSending) return;

    const currentQuote = quotedSelection;
    setPrompt("");
    setQuotedSelection(null);

    void aiSendFollowup({
      prompt: trimmed,
      quotedText: currentQuote?.text,
      sectionHeading: currentQuote?.heading,
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <section
      className="dl-island dl-ai-chat"
      aria-label="Interactive chat"
      style={{ flex: "none", height, display: "flex", flexDirection: "column" }}
    >
      <header className="dl-island-header">
        <span className="dl-island-title">Chat</span>
        <span className="dl-toolbar-spacer" />
        <button
          className="dl-tbtn"
          type="button"
          title="Clear thread"
          aria-label="Clear thread"
          disabled={chatMessages.length === 0}
          onClick={() => void aiClearThread()}
        >
          <Icon name="general-delete" />
        </button>
        <button className="dl-tbtn" type="button" title="Hide" aria-label="Hide" onClick={onClose}>
          <Icon name="general-hide" />
        </button>
      </header>

      <div className="dl-ai-chat-list" ref={listRef}>
        {chatMessages.map((msg) => (
          <div key={msg.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {msg.quotedText && (
              <div className="dl-ai-quote-chip">
                <Icon name="diff-magicResolveToolbar" />
                <span className="dl-ai-quote-text">{msg.quotedText}</span>
              </div>
            )}
            {msg.role === "user" ? (
              <div className="dl-ai-chat-msg is-user">{msg.content}</div>
            ) : (
              <div className="dl-ai-chat-msg is-assistant">
                <MarkdownDocument
                  markdown={cleanChatContent(msg.content)}
                  className="dl-ai-chat-md"
                />
                {msg.costUsd && (
                  <div className="dl-ai-turn-cost">
                    <Icon name="diff-magicResolveToolbar" />
                    <span>Cost {formatReviewCostUsd(msg.costUsd)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {isSending && (
          <div className="dl-ai-chat-msg is-assistant">
            <div>
              {streamingChat ? (
                <MarkdownDocument
                  markdown={cleanChatContent(streamingChat)}
                  className="dl-ai-chat-md"
                />
              ) : (
                "Analyzing follow-up question…"
              )}
              <span className="dl-caret" />
            </div>
          </div>
        )}
      </div>

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
              onClick={() => setQuotedSelection(null)}
            >
              <Icon name="general-close" />
            </button>
          </div>
        )}
        <div className="dl-ai-composer-row">
          <textarea
            ref={inputRef}
            className="dl-ai-composer-input dl-textarea"
            rows={1}
            placeholder="Ask about this review or request changes…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
          />
          <button
            className="dl-btn dl-btn-primary dl-btn-sm"
            type="button"
            disabled={isSending || !prompt.trim()}
            onClick={handleSend}
          >
            Send
          </button>
        </div>
        {isSending && (
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
            <button
              className="dl-btn dl-btn-sm"
              type="button"
              onClick={() => cancelTask("ai_followup")}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
