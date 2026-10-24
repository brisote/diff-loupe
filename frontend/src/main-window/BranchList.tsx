import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../lib/icon";

export type BranchSection = { title: string; names: string[] };

type Props = {
  id: string;
  label: string;
  sections: BranchSection[];
  selected: string | null;
  tags?: Record<string, string>;
  onChoose: (name: string) => void;
};

export function filterSections(sections: BranchSection[], query: string): BranchSection[] {
  const wanted = query.trim().toLowerCase();
  return sections
    .map((section) => ({
      title: section.title,
      names: section.names.filter((name) => name.toLowerCase().includes(wanted)),
    }))
    .filter((section) => section.names.length > 0);
}

export function BranchList({ id, label, sections, selected, tags = {}, onChoose }: Props) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => filterSections(sections, query), [sections, query]);
  const flat = shown.flatMap((section) => section.names.map((name) => `${section.title}:${name}`));
  const [active, setActive] = useState(0);

  const selectedIndex = flat.findIndex((key) => key.endsWith(`:${selected}`));

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    setActive(query ? 0 : Math.max(selectedIndex, 0));
  }, [query, selectedIndex]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => Math.min(Math.max(index + step, 0), flat.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const key = flat[active];
      if (key) onChoose(key.slice(key.indexOf(":") + 1));
    }
  };

  let index = -1;
  return (
    <>
      <label className="dl-field dl-popup-search" htmlFor={id}>
        <Icon name="general-search" />
        <input
          ref={input}
          id={id}
          placeholder="Search branches"
          aria-label="Search branches"
          aria-controls={`${id}-list`}
          aria-activedescendant={flat.length > 0 ? `${id}-${active}` : undefined}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>
      <div className="dl-popup-scroll" id={`${id}-list`} role="listbox" aria-label={label}>
        {shown.length === 0 && <div className="dl-popup-section">No matching branches</div>}
        {shown.map((section) => (
          <div key={section.title}>
            <div className="dl-popup-section" aria-hidden="true">
              {section.title}
            </div>
            {section.names.map((name) => {
              index += 1;
              const position = index;
              return (
                <div
                  key={name}
                  id={`${id}-${position}`}
                  className={`dl-row ${position === active ? "is-selected" : ""}`}
                  role="option"
                  aria-selected={name === selected}
                  aria-label={name}
                  tabIndex={-1}
                  onMouseEnter={() => setActive(position)}
                  onClick={() => onChoose(name)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onChoose(name);
                  }}
                >
                  <Icon name="toolwindows-vcs" />
                  <span className="dl-row-name">{name}</span>
                  <span className="dl-row-path" />
                  {tags[name] && <span className="dl-tag">{tags[name]}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
