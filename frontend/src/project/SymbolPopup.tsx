import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { SymbolMatch } from "../api";
import { fileIcon } from "../changes/fileIcons";
import { splitPath } from "../lib/paths";
import { Popup } from "../lib/popup";
import type { NavigatePoint } from "./symbolNav";

type Props = {
  symbol: string;
  matches: SymbolMatch[];
  truncated: boolean;
  point: NavigatePoint;
  onSelect: (match: SymbolMatch) => void;
  onClose: () => void;
};

export function SymbolPopup({ symbol, matches, truncated, point, onSelect, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const activeIndex = matches.length > 0 ? Math.min(index, matches.length - 1) : 0;

  const resetKey = `${symbol}:${matches.length}`;
  useEffect(() => {
    if (resetKey !== undefined) setIndex(0);
  }, [resetKey]);

  useEffect(() => {
    const activeEl = listRef.current?.children.item(activeIndex);
    if (activeEl && "scrollIntoView" in activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((current) => Math.min(Math.max(0, matches.length - 1), current + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((current) => Math.max(0, current - 1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const chosen = matches[activeIndex];
        if (chosen) onSelect(chosen);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [matches, activeIndex, onSelect]);

  const width = 560;
  const maxLeft =
    typeof window !== "undefined" ? Math.max(12, window.innerWidth - width - 12) : point.x;
  const maxTop =
    typeof window !== "undefined" ? Math.max(12, window.innerHeight - 320) : point.y + 12;
  const style: CSSProperties = {
    position: "fixed",
    left: Math.min(Math.max(12, point.x - 40), maxLeft),
    top: Math.min(Math.max(12, point.y + 12), maxTop),
    zIndex: 30,
  };

  const selected = matches[activeIndex] ?? matches[0];
  const countLabel = `${matches.length}${truncated ? "+" : ""} ${matches.length === 1 ? "usage" : "usages"}`;

  return (
    <Popup
      label={`Usages of ${symbol}`}
      role="dialog"
      className="dl-usages-popup"
      style={style}
      onClose={onClose}
    >
      <div className="dl-usages-head">
        <span className="dl-usages-title">
          <b>{symbol}</b>
        </span>
        <span className="dl-usages-count">{countLabel}</span>
      </div>
      <div ref={listRef} className="dl-usages-list" role="listbox" aria-label="Symbol usages">
        {matches.map((match, idx) => {
          const isSelected = idx === activeIndex;
          const { name } = splitPath(match.file);
          return (
            <div
              key={`${match.file}:${match.line}:${match.column}`}
              role="option"
              tabIndex={-1}
              aria-selected={isSelected}
              className={`dl-row dl-usage-row ${isSelected ? "is-selected" : ""}`}
              onMouseEnter={() => setIndex(idx)}
              onClick={() => onSelect(match)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(match);
                }
              }}
            >
              <span className={`dl-i ${fileIcon(match.file)}`} aria-hidden="true" />
              <span className="dl-usage-file">{name}</span>
              <span className="dl-usage-line">{match.line}</span>
              <span className="dl-usage-code">{match.preview}</span>
            </div>
          );
        })}
      </div>
      {selected && <div className="dl-usages-foot">{selected.file}</div>}
    </Popup>
  );
}
