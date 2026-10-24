import { useState } from "react";
import { Icon } from "../lib/icon";
import { Row } from "../lib/list";
import { displayPath } from "../lib/paths";
import { shortVersion } from "../lib/version";
import { WindowToolbar } from "../main-window/WindowToolbar";
import { useApp } from "../state/context";
import { OpenErrorBanner } from "./OpenErrorBanner";

export function Welcome() {
  const recent = useApp((state) => state.recent);
  const home = useApp((state) => state.info?.home);
  const version = useApp((state) => state.info?.version);
  const openError = useApp((state) => state.openError);
  const open = useApp((state) => state.open);
  const openPicked = useApp((state) => state.openPicked);
  const showDialog = useApp((state) => state.showDialog);
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const shown = recent.filter(
    (repo) =>
      !needle ||
      repo.name.toLowerCase().includes(needle) ||
      repo.path.toLowerCase().includes(needle),
  );

  return (
    <div className="app">
      <WindowToolbar />
      <div className="welcome">
        <nav className="dl-island welcome-nav" aria-label="Welcome">
          <div className="welcome-brand">
            <span className="welcome-name">Diffloupe</span>
            <span className="welcome-version">{version ? shortVersion(version) : ""}</span>
          </div>
          <div className="dl-list welcome-sections" role="listbox" aria-label="Sections">
            <Row selected onActivate={() => undefined}>
              <Icon name="toolwindows-vcs" />
              <span>Repositories</span>
            </Row>
            <Row onActivate={() => showDialog("settings")}>
              <Icon name="general-settings" />
              <span>Settings</span>
            </Row>
          </div>
        </nav>
        <main className="dl-island welcome-main">
          {openError && <OpenErrorBanner />}
          <div className="welcome-intro">
            <h1 className="ui-title">Welcome to Diffloupe</h1>
            <p>Open a git repository to read its changes, its branch history and its conflicts.</p>
          </div>
          <div className="welcome-actions">
            <label className="dl-field welcome-search" htmlFor="repo-search">
              <Icon name="general-search" />
              <input
                id="repo-search"
                placeholder="Search recent repositories"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button
              className="dl-btn dl-btn-primary"
              type="button"
              onClick={() => void openPicked()}
            >
              Open…
            </button>
          </div>
          {recent.length > 0 && (
            <div className="welcome-recent">
              <div className="ui-small welcome-label">Recent</div>
              <div className="dl-list" role="listbox" aria-label="Recent repositories">
                {shown.map((repo) => (
                  <Row
                    key={repo.path}
                    className="welcome-repo"
                    selected={(openError?.error.path ?? openError?.path) === repo.path}
                    label={repo.name}
                    onActivate={() => void open(repo.path)}
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
            </div>
          )}
          <div className="welcome-drop">
            <span className="welcome-drop-title">Drop a folder here to open it</span>
            <span>Any folder that git tracks works.</span>
          </div>
        </main>
      </div>
    </div>
  );
}
