import { useState } from "react";
import type { Settings, UpdateCheck } from "../api";
import { type ApiError, toApiError } from "../api";
import type { DiffSettings } from "../api/generated/DiffSettings";
import { Dialog } from "../lib/dialog";
import { Checkbox, Select } from "../lib/fields";
import { Icon } from "../lib/icon";
import { Row } from "../lib/list";
import { useApp } from "../state/context";
import type { SettingsPage } from "../state/store";
import type { UpdateInstall, UpdateStatus } from "../state/updates";

export function SettingsDialog() {
  const settings = useApp((state) => state.settings);
  const saveSettings = useApp((state) => state.saveSettings);
  const showDialog = useApp((state) => state.showDialog);
  const initialPage = useApp((state) => state.settingsPage);
  const [page, setPage] = useState<SettingsPage>(initialPage);
  const [draft, setDraft] = useState<Settings | null>(settings);
  const [error, setError] = useState<ApiError | null>(null);
  if (!draft) return null;

  const close = () => showDialog(null);
  const apply = async () => {
    try {
      await saveSettings(draft);
      setError(null);
      return true;
    } catch (failure) {
      setError(toApiError(failure));
      return false;
    }
  };
  const diff = (change: Partial<DiffSettings>) =>
    setDraft({ ...draft, diff: { ...draft.diff, ...change } });

  return (
    <Dialog label="Settings" className="app-settings" onClose={close}>
      <div className="dl-dialog-title app-settings-title">Settings</div>
      <div className="dl-settings">
        <nav className="dl-settings-nav" aria-label="Settings sections">
          <div className="dl-list app-flat-list" role="listbox" aria-label="Settings sections">
            <Row selected={page === "diff"} onActivate={() => setPage("diff")}>
              <span>Diff</span>
            </Row>
            <Row selected={page === "updates"} onActivate={() => setPage("updates")}>
              <span>Updates</span>
            </Row>
          </div>
        </nav>
        {page === "updates" ? (
          <UpdatesPage
            check={draft.updates.check}
            onCheck={(check) => setDraft({ ...draft, updates: { ...draft.updates, check } })}
          />
        ) : (
          <div className="dl-settings-page">
            <div className="dl-settings-title">Diff</div>
            <div className="dl-form">
              <span>Viewer</span>
              <Select
                label="Viewer"
                value={draft.diff.viewer}
                onChange={(viewer) => diff({ viewer })}
                options={[
                  { value: "sideBySide", label: "Side by side" },
                  { value: "unified", label: "Unified" },
                ]}
              />
              <span>Ignore</span>
              <Select
                label="Ignore"
                value={draft.diff.whitespace}
                onChange={(whitespace) => diff({ whitespace })}
                options={[
                  { value: "doNotIgnore", label: "Do not ignore" },
                  { value: "trim", label: "Trim whitespaces" },
                  { value: "ignore", label: "Ignore whitespaces" },
                  { value: "ignoreAndEmptyLines", label: "Ignore whitespaces and empty lines" },
                ]}
              />
              <span>Highlighting</span>
              <Select
                label="Highlighting"
                value={draft.diff.highlight}
                onChange={(highlight) => diff({ highlight })}
                options={[
                  { value: "words", label: "Words" },
                  { value: "lines", label: "Lines" },
                  { value: "characters", label: "Characters" },
                  { value: "none", label: "Do not highlight" },
                ]}
              />
              <span />
              <span className="app-checks">
                <Checkbox
                  label="Collapse unchanged fragments"
                  checked={draft.diff.collapseUnchanged}
                  onChange={(collapseUnchanged) => diff({ collapseUnchanged })}
                />
                <Checkbox
                  label="Synchronize scrolling"
                  checked={draft.diff.syncScroll}
                  onChange={(syncScroll) => diff({ syncScroll })}
                />
              </span>
              <span className="dl-form-group">Markdown files</span>
              <span>Open as</span>
              <Select
                label="Open as"
                value={draft.diff.markdown}
                onChange={(markdown) => diff({ markdown })}
                options={[
                  { value: "renderedSideBySide", label: "Rendered, side by side" },
                  { value: "renderedInline", label: "Rendered, inline" },
                  { value: "raw", label: "Raw" },
                ]}
              />
              <span className="dl-form-hint">
                The Rendered and Raw buttons in the diff toolbar switch one file at a time.
              </span>
            </div>
          </div>
        )}
      </div>
      {error && (
        <div className="app-settings-error">
          <div className="dl-banner is-error" role="alert">
            <Icon name="status-error" />
            <span className="dl-banner-text">Settings could not be saved. {error.message}</span>
            <span className="dl-banner-actions" />
          </div>
        </div>
      )}
      <div className="dl-dialog-footer">
        <button className="dl-btn" type="button" onClick={close}>
          Cancel
        </button>
        <button className="dl-btn" type="button" onClick={() => void apply()}>
          Apply
        </button>
        <button
          className="dl-btn dl-btn-primary"
          type="button"
          onClick={() => void apply().then((saved) => saved && close())}
        >
          OK
        </button>
      </div>
    </Dialog>
  );
}

function UpdatesPage({ check, onCheck }: { check: boolean; onCheck: (check: boolean) => void }) {
  const version = useApp((state) => state.info?.version ?? "");
  const status = useApp((state) => state.updateStatus);
  const checkForUpdate = useApp((state) => state.checkForUpdate);
  const downloadUpdate = useApp((state) => state.downloadUpdate);
  const restartToUpdate = useApp((state) => state.restartToUpdate);
  const install = useApp((state) => state.updateInstall);
  const repo = useApp((state) => state.repo);
  const showDialog = useApp((state) => state.showDialog);
  return (
    <div className="dl-settings-page">
      <div className="dl-settings-title">Updates</div>
      <div className="dl-form">
        <span />
        <span className="app-checks">
          <Checkbox
            label="Check for new versions automatically"
            checked={check}
            onChange={onCheck}
          />
        </span>
        <span className="dl-form-hint">
          This is the only network call Diffloupe makes on its own. It asks diffloupe.com for the
          latest version when it starts and once a day. The request names only the operating system,
          with no identifier and no usage data.
        </span>
        <span>Version</span>
        <span className="app-update-version">
          <span>{version}</span>
          <button
            className="dl-btn"
            type="button"
            disabled={status.state === "checking"}
            onClick={() => void checkForUpdate(true)}
          >
            Check now
          </button>
        </span>
        <span />
        <UpdateResult
          status={status}
          install={install}
          onUpdate={(check) => {
            if (repo) showDialog(null);
            void downloadUpdate(check);
          }}
          onRestart={() => void restartToUpdate()}
        />
      </div>
    </div>
  );
}

function UpdateResult({
  status,
  install,
  onUpdate,
  onRestart,
}: {
  status: UpdateStatus;
  install: UpdateInstall;
  onUpdate: (check: UpdateCheck) => void;
  onRestart: () => void;
}) {
  if (install.state === "downloading")
    return (
      <span className="app-update-result" role="status">
        <span className="dl-progress" role="progressbar" aria-label="Update download">
          <i />
        </span>
        <span>Downloading Diffloupe {install.check.latest}…</span>
      </span>
    );
  if (install.state === "ready" || install.state === "installing")
    return (
      <span className="app-update-result" role="status">
        <Icon name="status-info" />
        <span>Diffloupe {install.check.latest} is ready.</span>
        <button
          className="dl-btn dl-btn-primary"
          type="button"
          disabled={install.state === "installing"}
          onClick={onRestart}
        >
          Restart now
        </button>
      </span>
    );
  if (install.state === "failed")
    return (
      <span className="app-update-result" role="status">
        <Icon name="status-error" />
        <span>{install.message}</span>
        <button className="dl-btn" type="button" onClick={() => onUpdate(install.check)}>
          Try again
        </button>
      </span>
    );
  if (status.state === "idle") return <span />;
  if (status.state === "checking")
    return (
      <span className="app-update-result" role="status">
        <span className="dl-progress" role="progressbar" aria-label="Checking for updates">
          <i />
        </span>
        <span>Checking for a new version…</span>
      </span>
    );
  if (status.state === "failed")
    return (
      <span className="app-update-result" role="status">
        <Icon name="status-error" />
        <span>{status.message}</span>
      </span>
    );
  const { check } = status;
  if (!check.newer)
    return (
      <span className="app-update-result" role="status">
        <Icon name="status-success" />
        <span>Diffloupe {check.current} is the latest version.</span>
      </span>
    );
  return (
    <span className="app-update-result" role="status">
      <Icon name="status-info" />
      <span>Diffloupe {check.latest} is available.</span>
      <button className="dl-btn dl-btn-primary" type="button" onClick={() => onUpdate(check)}>
        Update
      </button>
    </span>
  );
}
