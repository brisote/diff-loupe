import { memo } from "react";
import type { StoredAiChatMessage } from "../api/generated/StoredAiChatMessage";
import { Icon } from "../lib/icon";
import { MarkdownDocument } from "../markdown-diff/MarkdownDocument";
import { formatReviewCostUsd } from "./money";

function cleanChatContent(content: string): string {
  if (content.includes("--- REPORT UPDATE ---")) {
    const parts = content.split("--- REPORT UPDATE ---");
    return (parts[0] ?? "").trim();
  }
  return content;
}

type AiChatThreadProps = {
  chatMessages: StoredAiChatMessage[];
  streamingChat: string | null;
  isFollowupStreaming: boolean;
};

export const AiChatThread = memo(function AiChatThread({
  chatMessages,
  streamingChat,
  isFollowupStreaming,
}: AiChatThreadProps) {
  if (chatMessages.length === 0 && !isFollowupStreaming) {
    return null;
  }

  return (
    <div className="dl-ai-thread">
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
      {isFollowupStreaming && (
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
  );
});
