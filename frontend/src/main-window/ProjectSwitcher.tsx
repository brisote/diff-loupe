import type { RefObject } from "react";
import { Icon } from "../lib/icon";
import { Row } from "../lib/list";
import { displayPath } from "../lib/paths";
import { Popup } from "../lib/popup";
import { useApp } from "../state/context";

type Props = { anchor: RefObject<HTMLElement | null>; onClose: () => void };

export function ProjectSwitcher({ anchor, onClose }: Props) {
  const recent = useApp((state) => state.recent);
  const current = useApp((state) => state.repo?.path);
  const home = useApp((state) => state.info?.home);
  const open = useApp((state) => state.open);
  const openPicked = useApp((state) => state.openPicked);

  const choose = (path: string) => {
    onClose();
    if (path !== current) void open(path);
  };

  return (
    <Popup
      label="Recent projects"
      role="dialog"
      className="app-project-switcher"
      anchor={anchor}
      onClose={onClose}
    >
      <div className="dl-popup-section">Recent projects</div>
      <div className="dl-popup-scroll" role="listbox" aria-label="Recent projects">
        {recent.map((repo) => (
          <Row
            key={repo.path}
            className="dl-project"
            selected={repo.path === current}
            label={repo.name}
            onActivate={() => choose(repo.path)}
          >
            <Icon name="nodes-folder" />
            <span className="dl-project-text">
              <span className="dl-project-name">{repo.name}</span>
              <span className="dl-project-path">{displayPath(repo.path, home)}</span>
            </span>
            {repo.branch && <span className="dl-tag">{repo.branch}</span>}
          </Row>
        ))}
      </div>
      <div className="dl-popup-footer">
        <button
          className="dl-btn"
          type="button"
          onClick={() => {
            onClose();
            void openPicked();
          }}
        >
          Open folder
        </button>
      </div>
    </Popup>
  );
}
