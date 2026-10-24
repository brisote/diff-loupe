import type { RefObject } from "react";
import type { DiffSettings } from "../api/generated/DiffSettings";
import { MenuRow } from "../lib/list";
import { Popup } from "../lib/popup";

type Props = {
  settings: DiffSettings;
  anchor: RefObject<HTMLElement | null>;
  onChange: (change: Partial<DiffSettings>) => void;
  onClose: () => void;
};

function Check({ on }: { on: boolean }) {
  return on ? (
    <svg className="app-check" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 8.2 6.8 11 12 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <span className="app-check" />
  );
}

const viewers = [
  { value: "sideBySide", label: "Side-by-side viewer" },
  { value: "unified", label: "Unified viewer" },
] as const;

const whitespace = [
  { value: "doNotIgnore", label: "Do not ignore" },
  { value: "trim", label: "Trim whitespaces" },
  { value: "ignore", label: "Ignore whitespaces" },
  { value: "ignoreAndEmptyLines", label: "Ignore whitespaces and empty lines" },
] as const;

const highlight = [
  { value: "words", label: "Highlight words" },
  { value: "lines", label: "Highlight lines" },
  { value: "characters", label: "Highlight characters" },
  { value: "none", label: "Do not highlight" },
] as const;

export function DiffSettingsMenu({ settings, anchor, onChange, onClose }: Props) {
  const pick = (change: Partial<DiffSettings>) => {
    onChange(change);
    onClose();
  };
  return (
    <Popup
      label="Diff settings"
      role="menu"
      className="app-diff-menu"
      anchor={anchor}
      onClose={onClose}
    >
      <div className="dl-popup-section">Viewer</div>
      {viewers.map((item) => (
        <MenuRow
          key={item.value}
          label={item.label}
          onActivate={() => pick({ viewer: item.value })}
        >
          <Check on={settings.viewer === item.value} />
          <span>{item.label}</span>
        </MenuRow>
      ))}
      <div className="dl-popup-section">Ignore</div>
      {whitespace.map((item) => (
        <MenuRow
          key={item.value}
          label={item.label}
          onActivate={() => pick({ whitespace: item.value })}
        >
          <Check on={settings.whitespace === item.value} />
          <span>{item.label}</span>
        </MenuRow>
      ))}
      <div className="dl-popup-section">Highlighting</div>
      {highlight.map((item) => (
        <MenuRow
          key={item.value}
          label={item.label}
          onActivate={() => pick({ highlight: item.value })}
        >
          <Check on={settings.highlight === item.value} />
          <span>{item.label}</span>
        </MenuRow>
      ))}
      <div className="dl-popup-sep" />
      <MenuRow
        label="Collapse unchanged fragments"
        onActivate={() => pick({ collapseUnchanged: !settings.collapseUnchanged })}
      >
        <Check on={settings.collapseUnchanged} />
        <span>Collapse unchanged fragments</span>
      </MenuRow>
      <MenuRow
        label="Synchronize scrolling"
        onActivate={() => pick({ syncScroll: !settings.syncScroll })}
      >
        <Check on={settings.syncScroll} />
        <span>Synchronize scrolling</span>
      </MenuRow>
    </Popup>
  );
}
