import { useRef, useState } from "react";
import type { DiffSettings } from "../api/generated/DiffSettings";
import type { MarkdownView } from "../api/generated/MarkdownView";
import { Icon } from "../lib/icon";
import { type Platform, shortcut } from "../lib/platform";
import { DiffSettingsMenu } from "./DiffSettingsMenu";

type Props = {
  platform: Platform;
  differences: number;
  separatorsOnly: boolean;
  current: number;
  fileIndex: number;
  fileCount: number;
  settings: DiffSettings;
  markdown?: { view: MarkdownView; available: boolean; onChange: (view: MarkdownView) => void };
  onDifference: (index: number) => void;
  onFile: (step: 1 | -1) => void;
  onSettings: (change: Partial<DiffSettings>) => void;
};

export function DiffToolbar({
  platform,
  differences,
  separatorsOnly,
  current,
  fileIndex,
  fileCount,
  settings,
  markdown,
  onDifference,
  onFile,
  onSettings,
}: Props) {
  const [menu, setMenu] = useState(false);
  const rendered = Boolean(markdown?.available) && markdown?.view !== "raw";
  const sideBySide = rendered
    ? markdown?.view === "renderedSideBySide"
    : settings.viewer === "sideBySide";
  const anchor = useRef<HTMLButtonElement>(null);
  const label = separatorsOnly
    ? "Only line separators differ"
    : differences === 1
      ? "1 difference"
      : `${differences} differences`;
  return (
    <div className="dl-toolbar app-diff-toolbar" role="toolbar" aria-label="Diff actions">
      <button
        className="dl-tbtn"
        type="button"
        aria-label={`Previous Difference ${shortcut(platform, "Shift+F7")}`}
        title={`Previous Difference ${shortcut(platform, "Shift+F7")}`}
        disabled={differences === 0 || current <= 0}
        onClick={() => onDifference(current - 1)}
      >
        <Icon name="general-up" />
      </button>
      <button
        className="dl-tbtn"
        type="button"
        aria-label="Next Difference F7"
        title="Next Difference F7"
        disabled={differences === 0 || current >= differences - 1}
        onClick={() => onDifference(current + 1)}
      >
        <Icon name="general-down" />
      </button>
      <span className="dl-tsep" />
      <button
        className="dl-tbtn"
        type="button"
        aria-label="Jump to Source F4"
        title="Jump to Source F4"
        disabled
      >
        <Icon name="general-edit" />
      </button>
      <span className="dl-tsep" />
      <button
        className="dl-tbtn"
        type="button"
        aria-label="Compare Previous File"
        title="Compare Previous File"
        disabled={fileIndex <= 0}
        onClick={() => onFile(-1)}
      >
        <Icon name="vcs-arrowLeft" />
      </button>
      <span className="dl-tlink">{fileCount > 0 ? `${fileIndex + 1}/${fileCount} files` : ""}</span>
      <button
        className="dl-tbtn"
        type="button"
        aria-label="Compare Next File"
        title="Compare Next File"
        disabled={fileIndex >= fileCount - 1}
        onClick={() => onFile(1)}
      >
        <Icon name="vcs-arrowRight" />
      </button>
      <span className="dl-tsep" />
      <button
        className={`dl-tbtn ${settings.collapseUnchanged ? "is-toggled" : ""}`}
        type="button"
        aria-label="Collapse Unchanged Fragments"
        title="Collapse Unchanged Fragments"
        aria-pressed={settings.collapseUnchanged}
        onClick={() => onSettings({ collapseUnchanged: !settings.collapseUnchanged })}
      >
        <Icon name="general-collapseAll" />
      </button>
      <span className="dl-toolbar-spacer" />
      <span className="dl-tlabel">{label}</span>
      {markdown && (
        <fieldset className="dl-seg app-fieldset" aria-label="Markdown view">
          <button
            className={`dl-tbtn app-seg-text ${rendered ? "is-selected" : ""}`}
            type="button"
            aria-pressed={rendered}
            disabled={!markdown.available}
            title={markdown.available ? undefined : "This file can only be shown as raw text"}
            onClick={() =>
              markdown.onChange(
                settings.viewer === "unified" ? "renderedInline" : "renderedSideBySide",
              )
            }
          >
            Rendered
          </button>
          <button
            className={`dl-tbtn app-seg-text ${rendered ? "" : "is-selected"}`}
            type="button"
            aria-pressed={!rendered}
            onClick={() => markdown.onChange("raw")}
          >
            Raw
          </button>
        </fieldset>
      )}
      <fieldset className="dl-seg app-fieldset" aria-label="Viewer">
        <button
          className={`dl-tbtn ${sideBySide ? "is-selected" : ""}`}
          type="button"
          aria-label="Side-by-side viewer"
          title="Side-by-side viewer"
          aria-pressed={sideBySide}
          onClick={() =>
            rendered
              ? markdown?.onChange("renderedSideBySide")
              : onSettings({ viewer: "sideBySide" })
          }
        >
          <Icon name="diff-sideBySide" />
        </button>
        <button
          className={`dl-tbtn ${sideBySide ? "" : "is-selected"}`}
          type="button"
          aria-label="Unified viewer"
          title="Unified viewer"
          aria-pressed={!sideBySide}
          onClick={() =>
            rendered ? markdown?.onChange("renderedInline") : onSettings({ viewer: "unified" })
          }
        >
          <Icon name="diff-unified" />
        </button>
      </fieldset>
      <button
        ref={anchor}
        className="dl-tbtn"
        type="button"
        aria-label="Diff settings"
        title="Diff settings"
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((open) => !open)}
      >
        <Icon name="general-settings" />
      </button>
      {menu && (
        <DiffSettingsMenu
          settings={settings}
          anchor={anchor}
          onChange={onSettings}
          onClose={() => setMenu(false)}
        />
      )}
    </div>
  );
}
