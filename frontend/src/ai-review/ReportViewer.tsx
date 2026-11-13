import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../lib/icon";
import { MarkdownDocument } from "../markdown-diff/MarkdownDocument";

type ReportViewerProps = {
  markdown: string;
  onAskSelection: (selection: { text: string; heading?: string }) => void;
};

type FloatingAction = {
  top: number;
  left: number;
  text: string;
  heading?: string;
};

export function ReportViewer({ markdown, onAskSelection }: ReportViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState<FloatingAction | null>(null);

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

  return (
    <div
      ref={containerRef}
      className="dl-md"
      style={{ position: "relative", maxWidth: 820, margin: "0 auto" }}
    >
      <MarkdownDocument markdown={markdown} />
      {floating && (
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
      )}
    </div>
  );
}
