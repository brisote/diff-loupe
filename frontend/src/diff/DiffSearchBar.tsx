import { type KeyboardEvent, useEffect, useRef } from "react";
import { Icon } from "../lib/icon";

type Props = {
  query: string;
  match: { current: number; total: number };
  caseSensitive: boolean;
  onQueryChange: (query: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleCase: () => void;
  onClose: () => void;
};

export function DiffSearchBar({
  query,
  match,
  caseSensitive,
  onQueryChange,
  onPrevious,
  onNext,
  onToggleCase,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onPrevious();
      else onNext();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (
      event.altKey &&
      (event.key.toLowerCase() === "c" || event.key === "ç" || event.code === "KeyC")
    ) {
      event.preventDefault();
      onToggleCase();
    }
  };

  const hasQuery = query.length > 0;
  const countText = hasQuery
    ? match.total > 0
      ? `${match.current} of ${match.total}`
      : "0 of 0"
    : "";
  const isEmpty = hasQuery && match.total === 0;

  return (
    <section className="dl-diff-search" aria-label="Find in diff">
      <div className="dl-field dl-diff-search-field">
        <Icon name="general-search" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Search"
          aria-label="Search diff"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {hasQuery && (
        <span className={`dl-diff-search-count${isEmpty ? " is-empty" : ""}`}>{countText}</span>
      )}
      <button
        className={`dl-tbtn${match.total === 0 ? " is-disabled" : ""}`}
        type="button"
        aria-label="Previous Match ⇧Enter"
        title="Previous Match (⇧Enter)"
        disabled={match.total === 0}
        onClick={onPrevious}
      >
        <Icon name="general-up" />
      </button>
      <button
        className={`dl-tbtn${match.total === 0 ? " is-disabled" : ""}`}
        type="button"
        aria-label="Next Match Enter"
        title="Next Match (Enter)"
        disabled={match.total === 0}
        onClick={onNext}
      >
        <Icon name="general-down" />
      </button>
      <button
        className={`dl-tbtn dl-diff-search-case${caseSensitive ? " is-toggled" : ""}`}
        type="button"
        aria-label="Match Case ⌥C"
        title="Match Case (⌥C)"
        aria-pressed={caseSensitive}
        onClick={onToggleCase}
      >
        Aa
      </button>
      <span className="dl-tsep" />
      <button
        className="dl-tbtn"
        type="button"
        aria-label="Close ⎋"
        title="Close (Escape)"
        onClick={onClose}
      >
        <Icon name="general-close" />
      </button>
    </section>
  );
}
