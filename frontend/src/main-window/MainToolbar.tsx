import { useCallback, useRef, useState } from "react";
import { Icon } from "../lib/icon";
import { useApp } from "../state/context";
import { BranchPicker } from "./BranchPicker";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SettingsMenu } from "./SettingsMenu";
import { WindowToolbar } from "./WindowToolbar";

type Menu = "projects" | "branches" | "settings";

export function MainToolbar() {
  const repo = useApp((state) => state.repo);
  const [menu, setMenu] = useState<Menu | null>(null);
  const projects = useRef<HTMLButtonElement>(null);
  const branch = useRef<HTMLButtonElement>(null);
  const settings = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setMenu(null), []);
  if (!repo) return null;
  const toggle = (next: Menu) => setMenu((current) => (current === next ? null : next));
  return (
    <WindowToolbar>
      <button
        ref={projects}
        className="dl-combo"
        type="button"
        aria-label="Recent projects"
        aria-haspopup="dialog"
        aria-expanded={menu === "projects"}
        onClick={() => toggle("projects")}
      >
        <Icon name="nodes-folder" />
        <span className="app-project-name">{repo.name}</span>
        <Icon name="general-chevronDown" />
      </button>
      <button
        ref={branch}
        className="dl-combo"
        type="button"
        title={repo.branch ?? "Detached HEAD"}
        aria-label="Current branch"
        aria-haspopup="dialog"
        aria-expanded={menu === "branches"}
        onClick={() => toggle("branches")}
      >
        <Icon name="toolwindows-vcs" />
        <span>{repo.branch ?? "Detached HEAD"}</span>
        <Icon name="general-chevronDown" />
      </button>
      <span className="dl-toolbar-spacer" />
      <button
        ref={settings}
        className="dl-tbtn"
        type="button"
        aria-label="Settings menu"
        aria-haspopup="menu"
        aria-expanded={menu === "settings"}
        onClick={() => toggle("settings")}
      >
        <Icon name="general-settings" />
      </button>
      {menu === "projects" && <ProjectSwitcher anchor={projects} onClose={close} />}
      {menu === "branches" && <BranchPicker anchor={branch} onClose={close} />}
      {menu === "settings" && <SettingsMenu anchor={settings} onClose={close} />}
    </WindowToolbar>
  );
}
