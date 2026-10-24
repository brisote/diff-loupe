import { useCallback, useRef, useState } from "react";
import type { ToolTab } from "../api";
import { ChangesView } from "../changes/ChangesView";
import { Icon } from "../lib/icon";
import { BranchLogView } from "../log/BranchLogView";
import { useApp } from "../state/context";
import { TargetPicker } from "./TargetPicker";

const tabs: { tab: ToolTab; label: string }[] = [
  { tab: "changes", label: "Changes" },
  { tab: "log", label: "Branch log" },
];

export function ToolWindow({ width }: { width: number }) {
  const repo = useApp((state) => state.repo);
  const setTab = useApp((state) => state.setTab);
  const anchor = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);
  const close = useCallback(() => setPicking(false), []);
  if (!repo) return null;
  return (
    <section className="dl-island app-tool" style={{ width }} aria-label="Tool window">
      {repo.lastTab === "changes" && (
        <div className="dl-targetbar">
          <button
            ref={anchor}
            className="dl-combo"
            type="button"
            title={targetTitle(repo.target, repo.defaultBranch)}
            aria-label="Target branch"
            aria-haspopup="dialog"
            aria-expanded={picking}
            onClick={() => setPicking((open) => !open)}
          >
            <Icon name="toolwindows-vcs" />
            <span className="dl-combo-label">Target</span>
            <span className="dl-combo-text">{repo.target ?? "none"}</span>
            <Icon name="general-chevronDown" />
          </button>
          {picking && <TargetPicker anchor={anchor} onClose={close} />}
        </div>
      )}
      <header className="dl-island-header">
        <div className="dl-tabs" role="tablist" aria-label="Tool window tabs">
          {tabs.map((item) => (
            <button
              key={item.tab}
              className={`dl-tab ${repo.lastTab === item.tab ? "is-selected" : ""}`}
              type="button"
              role="tab"
              aria-selected={repo.lastTab === item.tab}
              onClick={() => setTab(item.tab)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>
      <div
        className="dl-island-body app-tool-body"
        role="tabpanel"
        aria-label={repo.lastTab === "log" ? "Branch log" : "Changes"}
      >
        {repo.lastTab === "changes" ? <ChangesView /> : <BranchLogView />}
      </div>
    </section>
  );
}

function targetTitle(target: string | null, defaultBranch: string | null): string {
  if (!target) return "No target branch";
  return target === defaultBranch ? `${target} (default branch)` : target;
}
