import type { KeyboardEvent, ReactNode } from "react";

type RowProps = {
  className?: string;
  selected?: boolean;
  label?: string;
  title?: string;
  onActivate: () => void;
  children: ReactNode;
};

function rowKeys(onActivate: () => void) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const sibling =
        event.key === "ArrowDown"
          ? event.currentTarget.nextElementSibling
          : event.currentTarget.previousElementSibling;
      if (sibling instanceof HTMLElement && sibling.tabIndex >= 0) sibling.focus();
    }
  };
}

function rowClass(className: string | undefined, selected: boolean | undefined) {
  return ["dl-row", className, selected ? "is-selected" : ""].filter(Boolean).join(" ");
}

export function Row({ className, selected, label, title, onActivate, children }: RowProps) {
  return (
    <div
      className={rowClass(className, selected)}
      role="option"
      aria-selected={Boolean(selected)}
      aria-label={label}
      title={title}
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={rowKeys(onActivate)}
    >
      {children}
    </div>
  );
}

export function MenuRow({ className, label, title, onActivate, children }: RowProps) {
  return (
    <div
      className={rowClass(className, false)}
      role="menuitem"
      aria-label={label}
      title={title}
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={rowKeys(onActivate)}
    >
      {children}
    </div>
  );
}
